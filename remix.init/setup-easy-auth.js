const inquirer = require("inquirer");

async function setupEasyAuth(options) {
  const { url } = options

  console.log("Follow the instructions for creating an OAuth app on Google.")
  console.log("Instructions: https://developers.google.com/identity/protocols/oauth2/openid-connect")
  console.log("Enter below homepage URL and authorization callback URL when creating the app.")
  console.log(`Homepage URL: ${url}`)
  console.log(`Authorization callback URL: ${url}/.auth/login/google/callback`)
  const { clientId, clientSecret } = await inquirer.prompt([{
    name: "clientId",
    message: "Enter client ID:",
    type: "input"
  }, {
    name: "clientSecret",
    message: "Enter client Secret:",
    type: "input"
  }]);

  if (!clientId) throw Error('No clientId provided for Google provider')
  if (!clientSecret) throw Error('No clientSecret provided for Google provider')

  return { google: { clientId, clientSecret } }
}

module.exports = setupEasyAuth
