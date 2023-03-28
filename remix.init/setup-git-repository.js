const { execSync } = require('child_process')

function assertCommand(command, url) {
  try {
    execSync(`hash ${command}`, { stdio: 'pipe' })
  } catch (error) {
    console.log(`Please install '${command}' (${url}) and rerun the command.`)

    // Terminate setup process
    process.exit(0)
  }
}

async function setupGitRepository(appName, rootDirectory) {
  console.log(`Setting up repository: ${appName}... ⏰`)

  // Check for necessary commands exists
  assertCommand('git', 'https://git-scm.com/book/en/v2/Getting-Started-Installing-Git')
  assertCommand('gh', 'https://cli.github.com/manual/installation')

  console.log(`Auth with GitHub...`)

  execSync(`GH_DEBUG=1 gh auth login --hostname github.com --git-protocol https --web`, {
    stdio: 'inherit',
    encoding: 'utf8',
  })
  execSync(`git init`, {
    cwd: rootDirectory,
  })
  execSync(`git add .`, {
    cwd: rootDirectory,
  })
  execSync(`git commit -m "Initial commit"`, {
    cwd: rootDirectory,
  })

  execSync(`GH_DEBUG=1 gh repo create ${appName} --private --push --source ${rootDirectory}`, {
    cwd: rootDirectory,
  })

  execSync(`azd pipeline config`, {
    stdio: 'inherit',
    encoding: 'utf8',
    cwd: rootDirectory,
  })

  console.log(`Successfully setup repository 🎉`)
}

module.exports = setupGitRepository
