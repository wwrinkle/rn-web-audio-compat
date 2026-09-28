// The library lives one directory up (linked as rn-web-audio-compat via "file:.."), and the shared conformance suite in
// ../conformance. Watch the parent, but resolve every package from this app's node_modules only, so there is exactly
// one react-native / react-native-audio-api in the bundle.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const libRoot = path.resolve(projectRoot, '..');
const escape = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [libRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.blockList = [
  new RegExp(`^${escape(path.join(libRoot, 'node_modules'))}/.*`),
  new RegExp(`^${escape(path.join(libRoot, 'web-demo'))}/.*`),
];
module.exports = config;
