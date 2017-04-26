/**
 * Produces production builds of the React application (index.vr.js) and the
 * client-side implementation (client.js).
 */

'use strict';

const child_process = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

function buildScript(root, buildDir, input, output) {
  // Allow overriding the CLI location with an env variable
  const cliLocation = process.env.RN_CLI_LOCATION ||
    path.resolve('node_modules', 'react-native', 'local-cli', 'cli.js');
  return new Promise((resolve, reject) => {
    const npm = child_process.spawn(
      (/^win/.test(process.platform) ? 'node.exe' : 'node'),
      [
        cliLocation,
        'bundle',
        '--entry-file',
        input,
        '--platform',
        'vr',
        '--bundle-output',
        output,
        '--dev',
        'false',
        '--assets-dest',
        buildDir,
      ],
      {stdio: 'inherit', cwd: root}
    );
    npm.on('close', (code) => {
      if (code !== 0) {
        reject(code);
      }
      resolve();
    });
  });
}

function hasPackage(dir) {
  const packagePath = path.join(dir, 'package.json');
  try {
    fs.statSync(packagePath);
  } catch (e) {
    return false;
  }
  const pkg = require(packagePath);
  if (
    pkg &&
    pkg.dependencies &&
    pkg.dependencies['react-vr']
  ) {
    return true;
  }
  return false;
}

function walkDirSync(dir, options = {exclude: []}) {
  if (!fs.statSync(dir).isDirectory()) return dir;

  return fs.readdirSync(dir)
    .filter(f => options.exclude.indexOf(f) === -1)
    .map(f => walkDirSync(path.join(dir, f), options))
    .reduce((acc, f) => Array.isArray(f) ? [...acc, ...f] : [...acc, f], []);
}

function copyDirRecursive(root, dir, dest) {
  return new Promise((resolve, reject) => {
    const windows = /^win/.test(process.platform);
    const args = windows ? [] : ['-r'];
    const npm = child_process.spawn(
      (windows ? 'Xcopy' : 'cp'),
      [
        ...args,
        dir,
        dest
      ],
      {cwd: root}
    );
    npm.on('close', (code) => {
      if (code !== 0) {
        reject(code);
      }
      resolve();
    });
  });
}

function replaceBundleExtensionsInHtml(file, buildDir) {
  const bundleRegex = /([^"'])+\.bundle([^"'])+/g;

  return new Promise((resolve, reject) => {
    const contents = fs.readFile(file, (err, data) => {
      if (err) reject(err);

      let fileData = data.toString();
      const filePath = path.resolve(...buildDir, path.basename(file));
      const bundlePaths = fileData.match(bundleRegex);

      // If no matches were found, just write the file to the build directory
      if (!bundlePaths.length) fs.writeFile(filePath, data, err => {
        if (err) reject(err);
        resolve();
      });

      bundlePaths.forEach(p => {
        const updatedPath = path.sep + path.basename(p).split('.')[0] + '.bundle.js';
        fileData = fileData.replace(p, updatedPath);
      });

      fs.writeFile(filePath, fileData, err => {
        if (err) reject(err);
        resolve();
      });

    });
  });
}

let projectDir = process.cwd();
const buildDirName = 'build';
const buildDir = [projectDir, buildDirName];

while (!hasPackage(projectDir)) {
  const next = path.join(projectDir, '..');
  if (projectDir === next) {
    console.log('Could not find a React VR project directory');
    process.exit(1);
  }
  projectDir = path.join(projectDir, '..');
}

new Promise((resolve, reject) => {
  try {
    const stat = fs.statSync(path.join(...buildDir));
    if (stat.isDirectory()) {
      return resolve();
    }
  } catch (e) {}
  fs.mkdir(path.join(...buildDir), err => {
    if (err) {
      console.log(`Failed to create '${buildDirName}' directory`);
      return reject(1);
    }
    resolve();
  });
}).then(() => {
  // Walk the vr directory to find html, static assets, and js files for build
  const vrJsRegex = /\.vr\.js$/;
  const projectDirContents = walkDirSync(projectDir, {exclude: [
    'node_modules',
    'build',
    '__tests__',
    'static_assets',
    '.babelrc',
    '.flowconfig',
    '.git',
    '.gitignore',
    '.watchmanconfig',
    'yarn.lock',
    'package.json',
    'rn-cli.config.js'
  ]});
  const clientJsFile = projectDirContents.find(f => f.indexOf('client.js') !== -1);
  const staticAssetsDir = 'static_assets';
  const vrComponentFiles = projectDirContents
    .filter(file => vrJsRegex.test(file))
    .map(file => buildScript(
        projectDir,
        buildDir,
        path.resolve(projectDir, file),
        path.resolve(...buildDir, `${path.basename(file, '.vr.js')}.bundle.js`)
      )
    );
  const htmlFiles = projectDirContents
    .filter(file => path.extname(file) === '.html')
    .map(file => replaceBundleExtensionsInHtml(file, buildDir));

  return Promise.all([
    ...vrComponentFiles,
    ...htmlFiles,
    buildScript(
      projectDir,
      buildDir,
      path.resolve(clientJsFile),
      path.resolve(...buildDir, 'client.bundle.js')
    ),
    copyDirRecursive(
      projectDir,
      path.resolve(projectDir, staticAssetsDir),
      path.resolve(...buildDir, staticAssetsDir)
    )
  ]);
}).then(() => {
  console.log(
    `Production versions were successfully built.
    They can be found at ${path.resolve(...buildDir)}.`
  );
}).catch(err => {
  console.log(
    `An error occurred during the bundling process. Exited with code ${err}.
    \nLook at the packager output above to see what went wrong.`
  );
  process.exit(1);
});
