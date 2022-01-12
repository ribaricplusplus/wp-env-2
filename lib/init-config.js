/**
 * External dependencies
 */
const path = require( 'path' );
const { writeFile, mkdir } = require( 'fs' ).promises;
const { existsSync } = require( 'fs' );
const yaml = require( 'js-yaml' );
const os = require( 'os' );

/**
 * Internal dependencies
 */
const { readConfig } = require( './config' );
const buildDockerComposeConfig = require( './build-docker-compose-config' );
const { getCliImages, getPhpunitImages, getWpImages, shouldInstallXdebug } = require('./config-functions');

/**
 * @typedef {import('./config').WPConfig} WPConfig
 */

/**
 * Initializes the local environment so that Docker commands can be run. Reads
 * ./.wp-env.json, creates ~/.wp-env, ~/.wp-env/docker-compose.yml, and
 * ~/.wp-env/Dockerfile.
 *
 * @param {Object}  options
 * @param {Object}  options.spinner      A CLI spinner which indicates progress.
 * @param {boolean} options.debug        True if debug mode is enabled.
 * @param {string}  options.xdebug       The Xdebug mode to set. Defaults to "off".
 * @param {boolean} options.writeChanges If true, writes the parsed config to the
 *                                       required docker files like docker-compose
 *                                       and Dockerfile. By default, this is false
 *                                       and only the `start` command writes any
 *                                       changes.
 * @return {WPConfig} The-env config object.
 */
module.exports = async function initConfig( {
	spinner,
	debug,
	xdebug = 'off',
	writeChanges = false,
} ) {
	const configPath = path.resolve( '.wp-env.json' );
	const config = await readConfig( configPath );
	config.debug = debug;

	// Adding this to the config allows the start command to understand that the
	// config has changed when only the xdebug param has changed. This is needed
	// so that Docker will rebuild the image whenever the xdebug flag changes.
	config.xdebug = xdebug;

	const dockerComposeConfig = buildDockerComposeConfig( config );

	if ( config.debug ) {
		spinner.info(
			`Config:\n${ JSON.stringify(
				config,
				null,
				4
			) }\n\nDocker Compose Config:\n${ JSON.stringify(
				dockerComposeConfig,
				null,
				4
			) }`
		);
		spinner.start();
	}

	/**
	 * We avoid writing changes most of the time so that we can better pass params
	 * to the start command. For example, say you start wp-env with Xdebug enabled.
	 * If you then run another command, like opening bash in the wp instance, it
	 * would turn off Xdebug in the Dockerfile because it wouldn't have the --xdebug
	 * arg. This basically makes it such that wp-env start is the only command
	 * which updates any of the Docker configuration.
	 */
	if ( writeChanges ) {
		await mkdir( config.workDirectoryPath, { recursive: true } );

		await writeFile(
			config.dockerComposeConfigPath,
			yaml.dump( dockerComposeConfig )
		);

		await writeFile(
			path.resolve( config.workDirectoryPath, 'Dockerfile' ),
			dockerFileContents(
				config
			)
		);

		await writeFile(
			path.resolve( config.workDirectoryPath, 'Dockerfile-phpunit' ),
			dockerFilePhpunit(
				config
			)
		);

		await writeFile(
			path.resolve( config.workDirectoryPath, 'Dockerfile-cli' ),
			dockerFileCli(
				config
			)
		);
	} else if ( ! existsSync( config.workDirectoryPath ) ) {
		spinner.fail(
			'wp-env has not yet been initialized. Please run `wp-env start` to install the WordPress instance before using any other commands. This is only necessary to set up the environment for the first time; it is typically not necessary for the instance to be running after that in order to use other commands.'
		);
		process.exit( 1 );
	}

	return config;
};

/**
 * Checks the configured PHP version
 * against the minimum version supported by Xdebug
 *
 * @param {WPConfig} config
 * @return {boolean} Whether the PHP version is supported by Xdebug
 */
function checkXdebugPhpCompatibility( config ) {
	// By default, an undefined phpVersion uses the version on the docker image,
	// which is supported by Xdebug 3.
	const phpCompatibility = true;

	// If PHP version is defined
	// ensure it meets the Xdebug minimum compatibility requirment
	if ( config.env.development.phpVersion ) {
		const versionTokens = config.env.development.phpVersion.split( '.' );
		const majorVer = parseInt( versionTokens[ 0 ] );
		const minorVer = parseInt( versionTokens[ 1 ] );

		if ( isNaN( majorVer ) || isNaN( minorVer ) ) {
			throw new Error(
				'Something went wrong when parsing the PHP version.'
			);
		}

		// Xdebug 3 supports 7.2 and higher
		// Ensure user has specified a compatible PHP version
		if ( majorVer < 7 || ( majorVer === 7 && minorVer < 2 ) ) {
			throw new Error( 'Cannot use XDebug 3 on PHP < 7.2.' );
		}
	}

	return phpCompatibility;
}

/**
 * Generates the Dockerfile used by wp-env's development instance.
 *
 * @param {WPConfig} config The configuration object.
 *
 * @return {string} The dockerfile contents.
 */
function dockerFileContents( config ) {
	const { developmentWpImage: image } = getWpImages( config );
	// Don't install XDebug unless it is explicitly required

	return `FROM ${ image }

RUN apt-get -qy install $PHPIZE_DEPS && touch /usr/local/etc/php/php.ini

${ installGmpExtension() }

${ shouldInstallXdebug( config ) ? installXdebug( config.xdebug ) : '' }
`;
}

function installXdebug( enableXdebug ) {
	return `
# Install Xdebug (if less than v3)
RUN apt-get -y install iproute2
RUN WPENV_XDEBUG_VERSION=$( pecl list | grep -i xdebug | tail -n 1 | awk '{ print $2 }' ); \
	export WPENV_PHP_SCRIPT="if ( empty( '$WPENV_XDEBUG_VERSION' ) || version_compare( '3.0.0', '$WPENV_XDEBUG_VERSION', '>' ) ) { echo 'do_upgrade'; }"; \
	SHOULD_UPGRADE=$( php -r "$WPENV_PHP_SCRIPT" ); \
	if ! [ -z $SHOULD_UPGRADE  ]; then pecl install xdebug-3.1.2; fi
RUN docker-php-ext-enable xdebug
RUN echo 'xdebug.start_with_request=yes' >> /usr/local/etc/php/php.ini
RUN echo 'xdebug.mode=${ enableXdebug }' >> /usr/local/etc/php/php.ini
RUN HOST_IP=$(/sbin/ip route | awk '/default/ { print $3 }'); echo "xdebug.client_host=\"$HOST_IP\"" >> /usr/local/etc/php/php.ini
	`;
}

function dockerFilePhpunit( config ) {
	const phpunitImage = getPhpunitImages( config );
	return `
FROM ${phpunitImage}

${ installGmpExtension() }

${ shouldInstallXdebug( config ) ? installXdebug( config.xdebug ) : '' }

`
}

function dockerFileCli( config ) {
	const { developmentWpCliImage } = getCliImages( config );
	// Not including GMP extension here because CLi is not based on debian
	// And it doesn't matter much.
	return `
FROM ${ developmentWpCliImage }
`

}

function installGmpExtension() {
	return `
# GMP extension. See https://github.com/laradock/laradock/issues/652#issuecomment-286528587
RUN apt-get update -y
RUN apt-get install -y libgmp-dev re2c libmhash-dev libmcrypt-dev file
RUN if ! [ -e /usr/local/include/gmp.h ] ; then ln -s /usr/include/x86_64-linux-gnu/gmp.h /usr/local/include/; fi
RUN docker-php-ext-configure gmp
RUN docker-php-ext-install gmp
`
}
