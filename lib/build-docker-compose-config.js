'use strict';
/**
 * External dependencies
 */
const fs = require( 'fs' );
const path = require( 'path' );

/**
 * Internal dependencies
 */
const { hasSameCoreSource } = require( './wordpress' );
const { dbEnv } = require( './config' );
const { getPhpVersions, getWpImages, getCliImages, getPhpunitImages, shouldInstallXdebug } = require('./config-functions')

/**
 * @typedef {import('./config').WPConfig} WPConfig
 * @typedef {import('./config').WPServiceConfig} WPServiceConfig
 */

/**
 * Gets the volume mounts for an individual service.
 *
 * @param {WPServiceConfig} config           The service config to get the mounts from.
 * @param {string}          wordpressDefault The default internal path for the WordPress
 *                                           source code (such as tests-wordpress).
 *
 * @return {string[]} An array of volumes to mount in string format.
 */
function getMounts( config, wordpressDefault = 'wordpress' ) {
	// Top-level WordPress directory mounts (like wp-content/themes)
	const directoryMounts = Object.entries( config.mappings ).map(
		( [ wpDir, source ] ) => `${ source.path }:/var/www/html/${ wpDir }`
	);

	const pluginMounts = config.pluginSources.map(
		( source ) =>
			`${ source.path }:/var/www/html/wp-content/plugins/${ source.basename }`
	);

	const themeMounts = config.themeSources.map(
		( source ) =>
			`${ source.path }:/var/www/html/wp-content/themes/${ source.basename }`
	);

	const coreMount = `${
		config.coreSource ? config.coreSource.path : wordpressDefault
	}:/var/www/html`;

	return [ coreMount, ...directoryMounts, ...pluginMounts, ...themeMounts ];
}

/**
 * Creates a docker-compose config object which, when serialized into a
 * docker-compose.yml file, tells docker-compose how to run the environment.
 *
 * @param {WPConfig} config A wp-env config object.
 *
 * @return {Object} A docker-compose config object, ready to serialize into YAML.
 */
module.exports = function buildDockerComposeConfig( config ) {
	const developmentMounts = getMounts( config.env.development );
	const testsMounts = getMounts( config.env.tests, 'tests-wordpress' );

	// When both tests and development reference the same WP source, we need to
	// ensure that tests pulls from a copy of the files so that it maintains
	// a separate DB and config. Additionally, if the source type is local we
	// need to ensure:
	//
	// 1. That changes the user makes within the "core" directory are
	//    served in both the development and tests environments.
	// 2. That the development and tests environment use separate
	//    databases and `wp-content/uploads`.
	//
	// To do this we copy the local "core" files ($wordpress) to a tests
	// directory ($tests-wordpress) and instruct the tests environment
	// to source its files like so:
	//
	// - wp-config.php        <- $tests-wordpress/wp-config.php
	// - wp-config-sample.php <- $tests-wordpress/wp-config.php
	// - wp-content           <- $tests-wordpress/wp-content
	// - *                    <- $wordpress/*
	//
	// https://github.com/WordPress/gutenberg/issues/21164
	if (
		config.env.development.coreSource &&
		hasSameCoreSource( [ config.env.development, config.env.tests ] )
	) {
		const wpSource = config.env.development.coreSource;
		testsMounts.shift(); // Remove normal core mount.
		testsMounts.unshift(
			...[
				`${ wpSource.testsPath }:/var/www/html`,
				...( wpSource.type === 'local'
					? fs
							.readdirSync( wpSource.path )
							.filter(
								( filename ) =>
									filename !== 'wp-config.php' &&
									filename !== 'wp-config-sample.php' &&
									filename !== 'wp-content'
							)
							.map(
								( filename ) =>
									`${ path.join(
										wpSource.path,
										filename
									) }:/var/www/html/${ filename }`
							)
					: [] ),
			]
		);
	}

	// Set the default ports based on the config values.
	const developmentPorts = `\${WP_ENV_PORT:-${ config.env.development.port }}:80`;
	const testsPorts = `\${WP_ENV_TESTS_PORT:-${ config.env.tests.port }}:80`;

	// The www-data user in wordpress:cli has a different UID (82) to the
	// www-data user in wordpress (33). Ensure we use the wordpress www-data
	// user for CLI commands.
	// https://github.com/docker-library/wordpress/issues/256
	const cliUser = '33:33';

	// If the user mounted their own uploads folder, we should not override it in the phpunit service.
	const isMappingTestUploads = testsMounts.some( ( mount ) =>
		mount.endsWith( ':/var/www/html/wp-content/uploads' )
	);

	const customCliConfigPath = path.resolve(`./.wpenv-config/phpcli-custom.ini`)
	let cliMounts = []

	if ( fs.existsSync( customCliConfigPath ) ) {
		cliMounts = [ ...developmentMounts, `${customCliConfigPath}:/usr/local/etc/php/conf.d/phpcli-custom.ini` ]
	} else  {
		cliMounts = developmentMounts
	}

	return {
		version: '3.7',
		services: {
			mysql: {
				image: 'mariadb',
				ports: [ '3306' ],
				environment: {
					MYSQL_ROOT_PASSWORD:
						dbEnv.credentials.WORDPRESS_DB_PASSWORD,
					MYSQL_DATABASE: dbEnv.development.WORDPRESS_DB_NAME,
				},
				volumes: [ 'mysql:/var/lib/mysql' ],
			},
			'tests-mysql': {
				image: 'mariadb',
				ports: [ '3306' ],
				environment: {
					MYSQL_ROOT_PASSWORD:
						dbEnv.credentials.WORDPRESS_DB_PASSWORD,
					MYSQL_DATABASE: dbEnv.tests.WORDPRESS_DB_NAME,
				},
				volumes: [ 'mysql-test:/var/lib/mysql' ],
			},
			wordpress: {
				build: '.',
				depends_on: [ 'mysql' ],
				ports: [ developmentPorts ],
				environment: {
					...dbEnv.credentials,
					...dbEnv.development,
				},
				volumes: developmentMounts,
			},
			'tests-wordpress': {
				build: '.',
				depends_on: [ 'tests-mysql' ],
				ports: [ testsPorts ],
				environment: {
					...dbEnv.credentials,
					...dbEnv.tests,
				},
				volumes: testsMounts,
			},
			cli: {
				depends_on: [ 'wordpress' ],
				build: {
					context: '.',
					dockerfile: 'Dockerfile-cli'
				},
				volumes: cliMounts,
				user: cliUser,
				environment: {
					...dbEnv.credentials,
					...dbEnv.development,
				},
			},
			'tests-cli': {
				depends_on: [ 'tests-wordpress' ],
				build: {
					context: '.',
					dockerfile: 'Dockerfile-cli'
				},
				volumes: testsMounts,
				user: cliUser,
				environment: {
					...dbEnv.credentials,
					...dbEnv.tests,
				},
			},
			composer: {
				image: 'composer',
				volumes: [ `${ config.configDirectoryPath }:/app` ],
			},
			phpunit: {
				build: {
					context: '.',
					dockerfile: 'Dockerfile-phpunit'
				},
				depends_on: [ 'tests-wordpress' ],
				volumes: [
					...testsMounts,
					...( ! isMappingTestUploads
						? [ 'phpunit-uploads:/var/www/html/wp-content/uploads' ]
						: [] ),
					'phpunit-tmp:/tmp'
				],
				environment: {
					LOCAL_DIR: 'html',
					WP_PHPUNIT__TESTS_CONFIG:
						'/var/www/html/phpunit-wp-config.php',
					...dbEnv.credentials,
					...dbEnv.tests,
					...( shouldInstallXdebug(config) && { LOCAL_PHP_XDEBUG: 'true' } )
				},
			},
		},
		volumes: {
			...( ! config.env.development.coreSource && { wordpress: {} } ),
			...( ! config.env.tests.coreSource && { 'tests-wordpress': {} } ),
			mysql: {},
			'mysql-test': {},
			'phpunit-uploads': {},
			'phpunit-tmp': {}
		},
	};
};
