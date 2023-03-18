const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const inquirer = require("inquirer");
const { EOL } = require("os");
const sort = require("sort-package-json");

const setupGitRepository = require("./setup-git-repository");

const debugMode = true;

function debug(...str) {
  if (debugMode) {
    console.log(...str);
  }
}

function terminal(str, args) {
  const result = execSync(str, args);
  try {
    return JSON.parse(result);
  } catch (e) {
    console.error(e);
    return result;
  }
}

function escapeRegExp(string) {
  // $& means the whole matched string
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getRandomString(length) {
  return crypto.randomBytes(length).toString("hex");
}

function getRandomPassword(
  length = 20,
  wishlist = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()+_-=}{[]|:;"/?.><,`~'
) {
  return Array.from(crypto.randomBytes(length))
    .map((x) => wishlist[x % wishlist.length])
    .join("");
}

async function setupGithubWorkflow(
  appName,
  subscriptionId,
  tenantId,
  registryName,
  registryLoginServer,
  deploymentOutputs,
  deployYmlPath
) {
  await inquirer.prompt({
    message: `Set up a repository on GitHub and add the following configuration to your repository Github Actions secrets \n ${JSON.stringify(
      {
        AZURE_REGISTRY_NAME: registryName,
        AZURE_REGISTRY_URL: registryLoginServer,
        DATABASE_CONNECTION_STRING: deploymentOutputs.databaseConnectionString,
      },
      null,
      2
    )}`,
    type: "confirm",
  });

  const deployYmlSearchReplace = [
    { search: "${AZURE_WEBAPP_NAME}", replace: appName },
    {
      search: "${AZURE_REGISTRY_URL}",
      replace: registryLoginServer,
    },
    { search: "${AZURE_SUBSCRIPTION_ID}", replace: subscriptionId },
    { search: "${AZURE_TENTANT_ID}", replace: tenantId },
    { search: "${IMAGE_NAME}", replace: appName },
  ];

  let newDeployYml = fs.readFileSync(deployYmlPath, "utf8");

  deployYmlSearchReplace.forEach((replace) => {
    newDeployYml = newDeployYml.replace(
      new RegExp(escapeRegExp(replace.name), "g"),
      replace.content
    );
  });

  fs.writeFileSync(deployYmlPath, newDeployYml);
}

function setupPackageJson(appName, packageJsonPath) {
  const packageJson = fs.readFileSync(packageJsonPath, "utf8");
  const newPackageJson =
    JSON.stringify(
      sort({ ...JSON.parse(packageJson), name: appName }),
      null,
      2
    ) + "\n";

  fs.writeFileSync(packageJsonPath, newPackageJson);
}

function setupEnvironmentFile(
  exampleEnvPath,
  envPath,
  databaseConnectionStrings
) {
  const env = fs.readFileSync(exampleEnvPath, "utf8");

  let newEnv = env.replace(
    /^SESSION_SECRET=.*$/m,
    `SESSION_SECRET="${getRandomString(16)}"`
  );

  newEnv = newEnv.replace(
    /^DATABASE_URL=.*$/m,
    `DATABASE_URL="${databaseConnectionStrings.connectionString}"`
  );

  if (databaseConnectionStrings.shadowConnectionString) {
    newEnv += `${EOL}SHADOW_DATABASE_URL="${databaseConnectionStrings.shadowConnectionString}"`;
  }

  fs.writeFileSync(envPath, newEnv);
}

function setupReadme(rootDirectory, appName) {
  const readmePath = path.join(rootDirectory, "README.md");
  const readme = fs.readFileSync(readmePath, "utf8");
  const newReadme = readme.replace(
    new RegExp(escapeRegExp("chiptune-stack-template"), "g"),
    appName
  );

  fs.writeFileSync(readmePath, newReadme);
}

async function setupDatabase(azureDatabaseConnectionStrings) {
  const answers = await inquirer.prompt([
    {
      name: "dbType",
      type: "list",
      message: "What database server should we use?",
      choices: ["devcontainer", "Local", "Azure"],
      default: "Local",
    },
  ]);

  switch (answers.dbType) {
    case "devcontainer":
      return {
        database: "devcontainer",
        connectionString: "postgresql://postgres:$AzureR0cks!@db:5432/remix",
        shadowConnectionString: null,
      };
    case "Local":
      const localAnswers = await inquirer.prompt([
        {
          name: "connStr",
          type: "input",
          message: "What is the connection string?",
          default: "postgresql://postgres:postgres@localhost:5432/remix",
        },
      ]);

      return {
        database: "local",
        connectionString: localAnswers.connStr,
        shadowConnectionString: null,
      };
    case "Azure":
      return {
        database: "azure",
        connectionString: azureDatabaseConnectionStrings.connectionString,
        shadowConnectionString:
          azureDatabaseConnectionStrings.shadowConnectionString,
      };
    default:
      throw new Error("Unknown dbType");
  }
}

async function setupAzureResources(appName) {
  const azureSubscriptions = terminal(`az login`);

  debug("Azure login success", azureSubscriptions);

  const dbServerPassword = getRandomPassword();
  const dbServerUsername = appName;

  const subscriptionId = azureSubscriptions[0].id;
  const tenantId = azureSubscriptions[0].tenantId;

  const sessionSecret = appName;

  const location = "Europe";

  const deploymentParametersSearchReplace = [
    { search: "environmentName", replace: subscriptionId },
    { search: "location", replace: appName },
    { search: "webContainerAppName", replace: appName },
    { search: "databasePassword", replace: dbServerPassword },
    { search: "databaseUsername", replace: dbServerUsername },
    { search: "sessionSecret", replace: sessionSecret },
    { search: "webImageName", replace: appName },
  ];

  const parametersJSONFile = JSON.parse(
    fs.readFileSync(`${__dirname}/../infra/main.parameters.json`, "utf8")
  );

  deploymentParametersSearchReplace.forEach((parameter) => {
    parametersJSONFile.parameters[parameter.search].value = parameter.replace;
  });

  fs.writeFileSync(
    `${__dirname}/../infra/main-replaced.parameters.json`,
    JSON.stringify(parametersJSONFile, null, 2)
  );

  debug("Deploying stack to Azure with parameters...", parametersJSONFile);
  const deployment = terminal(
    `azd init --environment ${appName} --subscription ${subscriptionId} --location ${location}`
  );

  debug("Success!", JSON.stringify(deployment, null, 2));

  return {
    tenantId,
    subscriptionId,
    deploymentOutputs: deployment,
  };
}

async function main({ rootDirectory, ...rest }) {
  debug("Starting Remix template...", rootDirectory, rest);

  const exampleEnvPath = path.join(rootDirectory, ".env.example");
  const envPath = path.join(rootDirectory, ".env");
  const packageJsonPath = path.join(rootDirectory, "package.json");
  const deployYmlPath = path.join(
    rootDirectory,
    ".github",
    "workflows",
    "deploy.yml"
  );

  const dirName = path.basename(rootDirectory);
  const appName = dirName.replace(/-/g, "").slice(0, 12);

  debug(`Start creating app with name`, appName);

  const { tenantId, subscriptionId, deploymentOutputs } =
    await setupAzureResources(appName);

  console.log("Deployment", deploymentOutputs);

  setupDatabase(deploymentOutputs);

  setupGithubWorkflow(
    appName,
    subscriptionId,
    tenantId,
    deploymentOutputs.registryName,
    deploymentOutputs.registryLoginServer,
    deploymentOutputs.databaseConnectionStrings,
    deployYmlPath
  );

  setupReadme(rootDirectory, appName);

  setupEnvironmentFile(
    exampleEnvPath,
    envPath,
    deploymentOutputs.databaseConnectionStrings
  );

  setupPackageJson(packageJsonPath);

  await setupGitRepository({ appName: "maxpajtest4" });

  await Promise.all([fs.rm(path.join(rootDirectory, "LICENSE.md"))]);

  debug(
    `Now commit and push your code to your Github repository and check that the Github Action completes.`
  );

  debug(`Removing temporary files from disk.`);

  await Promise.all([fs.rm(path.join(rootDirectory, "LICENSE.md"))]);

  if (answers.dbType === "devcontainer") {
    debug(
      `Skipping the project setup until you open the devcontainer. Once done, "npm run setup" will execute on your behalf.`
    );
  } else {
    debug(
      `Running the setup script to make sure everything was set up properly`
    );
    terminal(`npm run setup`, { stdio: "inherit", cwd: rootDirectory });
  }

  debug(`✅ Project is ready! Start development with "npm run dev"`);
}

module.exports = main;
