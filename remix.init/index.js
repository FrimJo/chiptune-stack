const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs/promises");
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
  acrUsername,
  acrPassword,
  deploymentOutputs,
  deployYmlPath
) {
  await inquirer.prompt({
    message: `Set up a repository on GitHub and add the following configuration to your repository Github Actions secrets \n ${JSON.stringify(
      {
        AZURE_REGISTRY_USERNAME: acrUsername,
        AZURE_REGISTRY_PASSWORD: acrPassword,
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
      replace: deploymentOutputs.containerRegistryPrincipal,
    },
    { search: "${AZURE_SUBSCRIPTION_ID}", replace: subscriptionId },
    { search: "${AZURE_TENTANT_ID}", replace: tenantId },
    { search: "${IMAGE_NAME}", replace: appName },
  ];

  let newDeployYml = fs.readFile(deployYmlPath, "utf-8");

  deployYmlSearchReplace.forEach((replace) => {
    newDeployYml = newDeployYml.replace(
      new RegExp(escapeRegExp(replace.name), "g"),
      replace.content
    );
  });

  fs.writeFile(deployYmlPath, newDeployYml);
}

function setupPackageJson(appName, packageJsonPath) {
  const packageJson = fs.readFile(packageJsonPath, "utf-8");
  const newPackageJson =
    JSON.stringify(
      sort({ ...JSON.parse(packageJson), name: appName }),
      null,
      2
    ) + "\n";

  fs.writeFile(packageJsonPath, newPackageJson);
}

function setupEnvironmentFile(
  exampleEnvPath,
  envPath,
  databaseConnectionStrings
) {
  const env = fs.readFile(exampleEnvPath, "utf-8");

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

  fs.writeFile(envPath, newEnv);
}

function setupReadme(readmePath, appName) {
  const readme = fs.readFile(readmePath, "utf-8");
  const newReadme = readme.replace(
    new RegExp(escapeRegExp("chiptune-stack-template"), "g"),
    appName
  );

  fs.writeFile(readmePath, newReadme);
}

async function setupDatabase() {
  const answers = await inquirer.prompt([
    {
      name: "dbType",
      type: "list",
      message: "What database server should we use?",
      choices: ["devcontainer", "Local", "Azure"],
      default: "devcontainer",
    },
  ]);

  let connectionString = "";
  let shadowConnectionString = "";

  switch (answers.dbType) {
    case "devcontainer":
      connectionString = "postgresql://postgres:$AzureR0cks!@db:5432/remix";
      break;
    case "Local":
      const localAnswers = await inquirer.prompt([
        {
          name: "connStr",
          type: "input",
          message: "What is the connection string?",
          default: "postgresql://postgres:postgres@localhost:5432/remix",
        },
      ]);
      connectionString = localAnswers.connStr;
      break;
    case "Azure":
      const azureAnswers = await inquirer.prompt([
        {
          name: "connStr",
          type: "input",
          message: "What is the connection string?",
        },
        {
          name: "shadowConnectionString",
          message: "Database connection string for the shadow db:",
          type: "input",
        },
      ]);
      connectionString = azureAnswers.connStr;
      shadowConnectionString = azureAnswers.shadowConnectionString;
      break;
    default:
      throw new Error("Unknown dbType");
  }

  return {
    connectionString,
    shadowConnectionString,
  };
}

async function setupAzureResources(appName) {
  const azureSubscriptions = JSON.parse(execSync(`az login`));

  debug("Azure login success", azureSubscriptions);

  const dbServerPassword = getRandomPassword();
  const dbServerUsername = appName;

  const subscriptionId = azureSubscriptions[0].id;
  const tenantId = azureSubscriptions[0].tenantId;

  const deploymentParametersSearchReplace = [
    { search: "${AZURE_ENV_NAME}", replace: subscriptionId },
    { search: "${AZURE_LOCATION}", replace: appName },
    { search: "${SERVICE_WEB_IMAGE_NAME}", replace: appName },
    { search: "${DB_SERVER_PASSWORD}", replace: dbServerPassword },
    { search: "${DB_SERVER_USERNAME}", replace: dbServerUsername },
    { search: "${SESSION_SECRET}", replace: appName },
    { search: "${WEB_CONTAINER_APP_NAME}", replace: appName },
  ];

  const parametersJSONFile = JSON.parse(
    await fs.readFile(`${__dirname}/../infra/main.parameters.json`)
  );

  deploymentParametersSearchReplace.forEach((parameter) => {
    parametersJSONFile.parameters[parameter.search].value = parameter.replace;
  });

  await fs.writeFile(
    `${__dirname}/../infra/main-replaced.parameters.json`,
    JSON.stringify(parametersJSONFile, null, 2)
  );

  const location = "northeurope";
  const resourceGroup = JSON.parse(
    execSync(`az group create --location ${location} --name ${appName}`)
  );
  debug("Created new resource group", resourceGroup);

  const resourceGroupName = resourceGroup.name;

  debug("Deploying stack to Azure with parameters...", parametersJSONFile);
  const deployment = JSON.parse(
    execSync(
      `az deployment group create -g ${resourceGroupName} --template-file ${__dirname}/../infra/ --parameters @${__dirname}/../main-replaced.parameters.json --name ${appName}`
    )
  );

  debug("Success!", JSON.stringify(deployment, null, 2));

  debug("Setting up container registry access...");
  const acrRegistryId = execSync(
    `az acr show --name ${appName} --query "id" --output tsv`
  ).toString("utf8");
  const acrPassword = execSync(
    `az ad sp create-for-rbac --display-name ${appName} --scopes "${acrRegistryId}" --role acrpush --query "password" --output tsv`
  ).toString("utf8");
  const acrUsername = execSync(
    `az ad sp list --display-name ${appName} --query "[].appId" --output tsv`
  ).toString("utf8");

  return {
    tenantId,
    subscriptionId,
    acrPassword,
    acrUsername,
    deploymentOutputs: deployment.properties.outputs,
  };
}

async function main({ rootDirectory, ...rest }) {
  debug("Starting Remix template...", rootDirectory, rest);

  const readmePath = path.join(rootDirectory, "README.md");
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

  const databaseConnectionStrings = setupDatabase();

  const {
    tenantId,
    subscriptionId,
    acrUsername,
    acrPassword,
    deploymentOutputs,
  } = setupAzureResources();

  setupGithubWorkflow(
    appName,
    subscriptionId,
    tenantId,
    acrUsername,
    acrPassword,
    deploymentOutputs.databaseConnectionString,
    deployYmlPath
  );

  setupReadme(readmePath, appName);

  setupEnvironmentFile(exampleEnvPath, envPath, databaseConnectionStrings);

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
    execSync(`npm run setup`, { stdio: "inherit", cwd: rootDirectory });
  }

  debug(`✅ Project is ready! Start development with "npm run dev"`);
}

module.exports = main;
