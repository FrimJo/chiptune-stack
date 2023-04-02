const { execSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')
const inquirer = require('inquirer')
const { EOL } = require('os')
const sort = require('sort-package-json')

const setupEasyAuth = require('./setup-easy-auth')

const debugMode = true

function assertCommand(command, url) {
  try {
    execSync(`hash ${command}`, { stdio: 'pipe' })
  } catch (error) {
    console.log(`Please install '${command}' (${url}) and rerun the command.`)

    // Terminate setup process
    process.exit(0)
  }
}

function debug(...str) {
  if (debugMode) {
    console.log(...str)
  }
}

function terminal(str, args = {}) {
  const result = execSync(str, { encoding: 'utf8', ...args }).toString()
  try {
    return JSON.parse(result)
  } catch (e) {
    return result
  }
}

function escapeRegExp(string) {
  // $& means the whole matched string
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getRandomString(length) {
  return crypto.randomBytes(length).toString('hex')
}

function getRandomPassword(
  length = 20,
  wishlist = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()+_-=}{[]|:;"/?.><,`~'
) {
  return Array.from(crypto.randomBytes(length))
    .map((x) => wishlist[x % wishlist.length])
    .join('')
}

async function assertInstalledTools() {
  assertCommand('git', 'https://git-scm.com/book/en/v2/Getting-Started-Installing-Git')
  assertCommand('gh', 'https://cli.github.com/manual/installation')
}

async function setupPackageJson(appName, rootDirectory) {
  debug('Start setting up package.json file')
  const packageJsonPath = path.join(rootDirectory, 'package.json')
  const packageJson = await fs.readFile(packageJsonPath, 'utf8')
  const newPackageJson =
    JSON.stringify(sort({ ...JSON.parse(packageJson), name: appName }), null, 2) + '\n'

  await fs.writeFile(packageJsonPath, newPackageJson, { encoding: 'utf8' })
  debug('Done setting up package.json file')
}

function buildConnectionString(protocol, uri, database, username, password) {
  return `${protocol}://${username}:${password}@${uri}/${database}`
}

async function setupEnvironmentFile(
  databaseConnectionString,
  shadowConnectionString,
  rootDirectory
) {
  debug('Start setting up .env file')
  const exampleEnvPath = path.join(rootDirectory, '.env.example')
  const envPath = path.join(rootDirectory, '.env')
  const env = await fs.readFile(exampleEnvPath, 'utf8')

  let newEnv = env.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET="${getRandomString(16)}"`)

  newEnv = newEnv.replace(
    /^DATABASE_CONNECTION_STRING=.*$/m,
    `DATABASE_CONNECTION_STRING="${databaseConnectionString}"`
  )

  if (shadowConnectionString) {
    newEnv += `${EOL}SHADOW_DATABASE_CONNECTION_STRING="${shadowConnectionString}"`
  }

  await fs.writeFile(envPath, newEnv, {
    encoding: 'utf8',
  })

  debug('Done setting up .env file')
}

async function setupReadme(appName, rootDirectory) {
  debug('Start setting up README')

  const readmePath = path.join(rootDirectory, 'README.md')
  const readme = await fs.readFile(readmePath, 'utf8')
  const newReadme = readme.replace(
    new RegExp(escapeRegExp('chiptune-stack-template'), 'g'),
    appName
  )

  await fs.writeFile(readmePath, newReadme, {
    encoding: 'utf8',
  })
  debug('Done setting up README')
}

async function setupDatabase(deploymentOutputs, dbServerPassword) {
  debug('Start setting up database connection')

  const answers = await inquirer.prompt([
    {
      name: 'dbType',
      type: 'list',
      message: 'What database server should we use?',
      choices: ['devcontainer', 'Local', 'Azure'],
      default: 'Local',
    },
  ])

  switch (answers.dbType) {
    case 'devcontainer':
      return {
        database: 'devcontainer',
        connectionString: 'postgresql://postgres:$AzureR0cks!@db:5432/remix',
        shadowConnectionString: null,
      }
    case 'Local':
      const localAnswers = await inquirer.prompt([
        {
          name: 'connectionString',
          type: 'input',
          message: 'What is the connection string?',
          default: 'postgresql://postgres:postgres@localhost:5432/remix',
        },
      ])

      return {
        database: 'local',
        connectionString: localAnswers.connectionString,
        shadowConnectionString: null,
      }
    case 'Azure':
      return {
        database: 'azure',
        connectionString: buildConnectionString(
          'postgres',
          deploymentOutputs.AZURE_DATABASE_SERVER_HOST.value,
          deploymentOutputs.AZURE_DATABASE_NAME.value,
          deploymentOutputs.AZURE_DATABASE_USERNAME.value,
          dbServerPassword
        ),
        shadowConnectionString: '',
      }
    default:
      throw new Error('Unknown dbType')
  }
}

async function setupAzureDev(rootDirectory) {
  execSync(`azd pipeline config`, {
    stdio: 'inherit',
    encoding: 'utf8',
    cwd: rootDirectory,
  })
}

async function setupAzureResources(appName, rootDirectory) {
  debug('Start setting up Azure resources')

  const azureSubscriptions = terminal(`az login`)

  debug('Azure login success!')

  const dbServerPassword = getRandomPassword()
  const dbServerUsername = appName

  const subscriptionId = azureSubscriptions[0].id
  const sessionSecret = getRandomString(16)
  const location = 'northeurope'

  const deploymentParametersSearchReplace = [
    { search: 'location', replace: location },
    { search: 'environmentName', replace: appName },
    { search: 'webContainerAppName', replace: appName },
    { search: 'databasePassword', replace: dbServerPassword },
    { search: 'databaseUsername', replace: dbServerUsername },
    { search: 'sessionSecret', replace: sessionSecret },
    { search: 'webImageName', replace: 'nginx:latest' },
  ]

  const parametersFilePath = `${rootDirectory}/infra/main.parameters.json`

  const parametersJSONFile = JSON.parse(await fs.readFile(parametersFilePath, 'utf8'))

  deploymentParametersSearchReplace.forEach((parameter) => {
    parametersJSONFile.parameters[parameter.search].value = parameter.replace
  })

  await fs.writeFile(parametersFilePath, JSON.stringify(parametersJSONFile, null, 2), {
    encoding: 'utf8',
  })

  debug('Inititalizing and deploying, hold on...')

  terminal(
    `azd init --cwd ${rootDirectory} --environment ${appName} --subscription ${subscriptionId} --location ${location}`
  )

  const deployment = terminal(`azd provision --cwd ${rootDirectory} --output json`)

  debug('Success!', deployment)

  debug('Done setting up Azure resources')

  return {
    deploymentOutputs: deployment.outputs,
    dbServerPassword,
  }
}

async function setupIdentityProviders(rootDirectory, providers) {
  if (providers.google) {
    const parametersWebJSONFile = `${rootDirectory}/infra/app/web.parameters.json`
    const webParametersJSONFile = JSON.parse(await fs.readFile(parametersWebJSONFile, 'utf8'))
    webParametersJSONFile.parameters['googleClientId'].value = providers.google.clientId
    webParametersJSONFile.parameters['googleClientSecret'].value = providers.google.clientSecret
    webParametersJSONFile.parameters['useIdentityProviders'].value = true

    await fs.writeFile(webParametersJSONFile, JSON.stringify(parametersWebJSONFile, null, 2), {
      encoding: 'utf8',
    })
  }
}

async function removeFiles(pathsToRemove, rootDirectory) {
  await Promise.all(
    pathsToRemove.map((p) => fs.rm(path.join(rootDirectory, p), { recursive: true, force: true }))
  )
}

async function main({ rootDirectory }) {
  await removeFiles(['LICENSE.md', '.git'], rootDirectory)

  // Check for necessary commands exists
  await assertInstalledTools()

  const appName = path.basename(rootDirectory).replace(/-/g, '').slice(0, 6) + getRandomString(6)

  debug(`Start creating Remix app with name`, appName, `in`, rootDirectory)

  // Check if user wants to add authentication
  const answer = await inquirer.prompt({
    name: 'provider',
    message: 'Add Google as authentication provider?',
    type: 'confirm',
    default: true,
  })

  const { deploymentOutputs, dbServerPassword } = await setupAzureResources(appName, rootDirectory)

  if (answer.provider) {
    const identityProviders = await setupEasyAuth({
      url: deploymentOutputs.REACT_APP_WEB_BASE_URL.value,
    })
    await setupIdentityProviders(rootDirectory, identityProviders)
  }

  const { database, connectionString, shadowConnectionString } = await setupDatabase(
    deploymentOutputs,
    dbServerPassword
  )

  await setupReadme(appName, rootDirectory)

  await setupEnvironmentFile(connectionString, shadowConnectionString, rootDirectory)

  await setupPackageJson(appName, rootDirectory)

  await setupAzureDev(rootDirectory)

  setupEnvironmentFile(deploymentOutputs.AZURE_DATABASE_SERVER_HOST, rootDirectory)

  setupPackageJson(appName, rootDirectory)

  if (database === 'devcontainer') {
    debug(
      `Skipping the project setup until you open the devcontainer. Once done, "npm run setup" will execute on your behalf.`
    )
  } else {
    debug(`Running the setup script to make sure everything was set up properly`)
    terminal(`npm run setup`, { stdio: 'inherit', cwd: rootDirectory })
  }

  debug(`✅ Project is ready! Start development with "npm run dev"`)
}

module.exports = main
