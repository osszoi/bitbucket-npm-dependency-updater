const { Command } = require('commander');
const simpleGit = require('simple-git');
const fs = require('fs');
const path = require('path');
const jsonfile = require('jsonfile');
const inquirer = require('inquirer').default;
const fsExtra = require('fs-extra');
const { config } = require('dotenv');
const { fileURLToPath } = require('url');
const { dirname } = require('path');
const bbr = require('bitbucket-repo-utils');

const {
	checkBranchExists,
	fetchRepositories,
	loadCredentials,
	saveCredentials
} = bbr;

config();

// __filename and __dirname in CommonJS
// const __filename = fileURLToPath(require.resolve('./index.js')); // Use require.resolve for paths
// const __dirname = dirname(__filename);

const git = simpleGit();

const configFilePath = path.join(__dirname, 'config.json');

function updatePackageVersion(repoDir, library, version) {
	const packageJsonPath = path.join(repoDir, 'package.json');

	if (fs.existsSync(packageJsonPath)) {
		const packageJson = jsonfile.readFileSync(packageJsonPath);
		if (packageJson.dependencies && packageJson.dependencies[library]) {
			packageJson.dependencies[library] = version;
			jsonfile.writeFileSync(packageJsonPath, packageJson, { spaces: 2 });
			console.log(`Updated ${library} version to ${version}`);
			return true;
		} else {
			console.log(`${library} not found in dependencies`);
			return false;
		}
	} else {
		console.log('Not a Node.js project (no package.json found)');
		return false;
	}
}

async function run(branch, version, library) {
	const { username, appPassword } = loadCredentials(configFilePath);

	if (!username || !appPassword) {
		console.error(`You must set username and password first.`);
		return;
	}

	// Prompt user if parameters are not provided via command-line
	if (!branch || !version || !library) {
		const answers = await inquirer.prompt([
			{
				type: 'input',
				name: 'branch',
				message: 'Enter the branch name to check:',
				when: !branch
			},
			{
				type: 'input',
				name: 'library',
				message: 'Enter the library to update:',
				when: !library
			},
			{
				type: 'input',
				name: 'version',
				message: 'Enter the version:',
				when: !version
			}
		]);

		branch = branch || answers.branch;
		version = version || answers.version;
		library = library || answers.library;
	}

	const tempDir = path.join(__dirname, 'temp-clones');
	fsExtra.ensureDirSync(tempDir);

	const allRepos = await fetchRepositories(username, appPassword);

	for (let repo of allRepos) {
		const branchExists = await checkBranchExists(
			username,
			appPassword,
			repo.full_name,
			branch
		);

		if (branchExists) {
			try {
				console.log(`Cloning ${repo.slug} into temp directory...`);
				const cloneDir = path.join(tempDir, repo.slug);
				await git.clone(repo.links.clone[0].href, cloneDir);
				await git.cwd(cloneDir);
				await git.checkout(branch);

				if (updatePackageVersion(cloneDir, version)) {
					console.log('Committing and pushing changes...');
					await git.add('.');
					await git.commit(
						`Update ${cliLibrary} to version ${version} (scripted update)`
					);
					await git.push('origin', branch);
					console.log(`✅ Pushed changes to ${branch} in ${repo.slug}`);
				}
			} catch (err) {
				console.error(
					`Error while trying to clone, checkout & update ${repo.slug}.\n${err}`
				);
			}
		} else {
			console.log(`Branch '${branch}' doesn't exist in ${repo.full_name}`);
		}
	}

	console.log('Cleaning up temporary files...');
	fsExtra.removeSync(tempDir);
	console.log('Cleanup complete.');
}

const program = new Command();

program
	.name('bb-ndu')
	.description('A CLI tool for managing repositories and more')
	.version('1.0.0');

program
	.command('update')
	.description('Update package versions in repositories')
	.option('-b, --branch <branch>', 'Branch name to check')
	.option('-v, --newversion <newversion>', 'Version to update')
	.option('-l, --library <library>', 'Library to update')
	.action((options) => {
		run(options.branch, options.newversion, options.library);
	});

program
	.command('set-username <username>')
	.description('Set your Bitbucket username.')
	.action((username) => {
		const credentials = loadCredentials(configFilePath);
		credentials.username = username;
		saveCredentials(credentials, configFilePath);
		console.log(`Username set to: ${username}`);
	});

program
	.command('set-password <appPassword>')
	.description('Set your Bitbucket app password.')
	.action((appPassword) => {
		const credentials = loadCredentials(configFilePath);
		credentials.appPassword = appPassword;
		saveCredentials(credentials, configFilePath);
		console.log('App password set.');
	});

program.parse(process.argv);
