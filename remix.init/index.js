const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const inquirer = require("inquirer");
const { EOL } = require("os");
const sort = require("sort-package-json");

const setupGitRepository = require("./setup-git-repository");

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

async function main({ rootDirectory, ...rest }) {
  console.log("Starting Remix template...", rootDirectory, rest);

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
  console.log(`Start creating app with name`, appName);

  const azureSubscriptions = JSON.parse(execSync(`az login`));
  console.log("Azure login success", azureSubscriptions);

  const parametersJSONFile = JSON.parse(
    await fs.readFile(`${__dirname}/azure/parameters.json`)
  );

  const sqlServerPassword = getRandomPassword();
  const sqlServerUsername = appName;

  const subscriptionId = azureSubscriptions[0].id;
  const tenantId = azureSubscriptions[0].tenantId;

  const parametersSearchReplace = [
    { search: "azure_subscription_id", replace: subscriptionId },
    { search: "web_site_name", replace: appName },
    { search: "sql_server_name", replace: appName },
    { search: "web_serverfarms_name", replace: appName },
    { search: "container_registry_name", replace: appName },
    { search: "container_registry_image_name_and_label", replace: appName },
    { search: "container_registry_username", replace: "Username.1" },
    { search: "sql_server_admin_username", replace: sqlServerUsername },
    { search: "sql_server_admin_password", replace: sqlServerPassword },
  ];

  parametersSearchReplace.forEach((parameter) => {
    parametersJSONFile.parameters[parameter.search].value = parameter.replace;
  });

  await fs.writeFile(
    `${__dirname}/azure/replaced_parameters.json`,
    JSON.stringify(parametersJSONFile, null, 2)
  );

  const location = "northeurope";
  const resourceGroup = JSON.parse(
    execSync(`az group create --location ${location} --name ${appName}`)
  );
  console.log("Created new resource group", resourceGroup);

  const resourceGroupName = resourceGroup.name;

  console.log(
    "Deploying stack to Azure with parameters...",
    parametersJSONFile
  );
  const deployment = JSON.parse(
    execSync(
      `az deployment group create -g ${resourceGroupName} --template-file ${__dirname}/azure/template.json --parameters @${__dirname}/azure/replaced_parameters.json --name ${appName}`
    )
  );
  console.log("Success!", JSON.stringify(deployment, null, 2));

  var outputs = deployment.properties.outputs;

  console.log("Setting up container registry access...");
  const acrRegistryId = execSync(
    `az acr show --name ${appName} --query "id" --output tsv`
  ).toString("utf8");
  const acrPassword = execSync(
    `az ad sp create-for-rbac --display-name ${appName} --scopes "${acrRegistryId}" --role acrpush --query "password" --output tsv`
  ).toString("utf8");
  const acrUsername = execSync(
    `az ad sp list --display-name ${appName} --query "[].appId" --output tsv`
  ).toString("utf8");

  console.log(
    `Add the following configuration to your repository Github Actions secrets: `
  );
  console.log(
    JSON.stringify(
      {
        AZURE_REGISTRY_USERNAME: acrUsername,
        AZURE_REGISTRY_PASSWORD: acrPassword,
        DATABASE_CONNECTION_STRING:
          deployment.outputs.sqlServerConnectionString.value,
      },
      null,
      2
    )
  );

  await inquirer.prompt({ type: "confirm" });

  const [readme, env, packageJson, deployYml] = await Promise.all([
    fs.readFile(readmePath, "utf-8"),
    fs.readFile(exampleEnvPath, "utf-8"),
    fs.readFile(packageJsonPath, "utf-8"),
    fs.readFile(deployYmlPath, "utf-8"),
  ]);

  let newEnv = env.replace(
    /^SESSION_SECRET=.*$/m,
    `SESSION_SECRET="${getRandomString(16)}"`
  );
  const newReadme = readme.replace(
    new RegExp(escapeRegExp("chiptune-stack-template"), "g"),
    appName
  );

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

  newEnv = newEnv.replace(
    /^DATABASE_URL=.*$/m,
    `DATABASE_URL="${connectionString}"`
  );
  if (shadowConnectionString) {
    newEnv += `${EOL}SHADOW_DATABASE_URL="${shadowConnectionString}"`;
  }

  await setupGitRepository({ appName: "maxpajtest4" });

  const newPackageJson =
    JSON.stringify(
      sort({ ...JSON.parse(packageJson), name: appName }),
      null,
      2
    ) + "\n";

  const newDeployYml = deployYml;
  const deployYmlSearchReplace = [
    { search: "${AZURE_WEBAPP_NAME}", replace: appName },
    {
      search: "${AZURE_REGISTRY_URL}",
      replace: outputs.containerRegistryPrincipal,
    },
    { search: "${AZURE_SUBSCRIPTION_ID}", replace: subscriptionId },
    { search: "${AZURE_TENTANT_ID}", replace: tenantId },
    { search: "${IMAGE_NAME}", replace: appName },
  ];

  deployYmlSearchReplace.forEach((replace) => {
    newDeployYml.replace(
      new RegExp(escapeRegExp(replace.name), "g"),
      replace.content
    );
  });

  await Promise.all([
    fs.writeFile(readmePath, newReadme),
    fs.writeFile(envPath, newEnv),
    fs.writeFile(packageJsonPath, newPackageJson),
    fs.writeFile(deployYmlPath, newDeployYml),
  ]);

  await Promise.all([fs.rm(path.join(rootDirectory, "LICENSE.md"))]);

  console.log(
    `Now commit and push your code to your Github repository and check that the Github Action completes.`
  );

  console.log(`Removing temporary files from disk.`);

  await Promise.all([fs.rm(path.join(rootDirectory, "LICENSE.md"))]);

  if (answers.dbType === "devcontainer") {
    console.log(
      `Skipping the project setup until you open the devcontainer. Once done, "npm run setup" will execute on your behalf.`
    );
  } else {
    console.log(
      `Running the setup script to make sure everything was set up properly`
    );
    execSync(`npm run setup`, { stdio: "inherit", cwd: rootDirectory });
  }

  console.log(`✅ Project is ready! Start development with "npm run dev"`);
}

module.exports = main;
