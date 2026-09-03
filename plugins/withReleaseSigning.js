/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Expo config plugin: signs release builds with a local keystore so the APK
 * can be sideloaded and upgraded in place on the phone.
 *
 * Expects (both git-ignored, created by `npm run keystore`):
 *   credentials/release.jks
 *   credentials/keystore.properties   (storePassword, keyPassword, keyAlias)
 * Falls back to the debug keystore when they are missing.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// roombahome2-release-signing';

function patchBuildGradle(contents) {
  if (contents.includes(MARKER)) return contents;

  const props = `
${MARKER}
def rh2KeystoreProps = new Properties()
def rh2KeystorePropsFile = rootProject.file("../credentials/keystore.properties")
def rh2HasKeystore = rh2KeystorePropsFile.exists() && rootProject.file("../credentials/release.jks").exists()
if (rh2HasKeystore) {
    rh2KeystoreProps.load(new FileInputStream(rh2KeystorePropsFile))
}
`;
  contents = contents.replace(/android \{/, `${props}\nandroid {`);

  contents = contents.replace(
    /signingConfigs \{\s*debug \{[\s\S]*?\n {8}\}\n {4}\}/,
    (block) =>
      block.replace(
        /\n {4}\}$/,
        `
        release {
            if (rh2HasKeystore) {
                storeFile rootProject.file("../credentials/release.jks")
                storePassword rh2KeystoreProps['storePassword']
                keyAlias rh2KeystoreProps['keyAlias']
                keyPassword rh2KeystoreProps['keyPassword']
            }
        }
    }`,
      ),
  );

  // Use the release signing config for release builds when a keystore exists.
  contents = contents.replace(
    /release \{\s*\n(\s*)\/\/ Caution! In production, you need to generate your own keystore file\.[\s\S]*?signingConfig signingConfigs\.debug/,
    (block, indent) =>
      block.replace(
        'signingConfig signingConfigs.debug',
        `signingConfig rh2HasKeystore ? signingConfigs.release : signingConfigs.debug`,
      ) + `\n${indent}// (signing chosen above)`,
  );
  return contents;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language === 'groovy') {
      cfg.modResults.contents = patchBuildGradle(cfg.modResults.contents);
    }
    return cfg;
  });
};
