function getPhpVersions( config ) {
	return {
		developmentPhpVersion: config.env.development.phpVersion
			? config.env.development.phpVersion
			: '',
		testsPhpVersion: config.env.tests.phpVersion
			? config.env.tests.phpVersion
			: ''
	}
}

function getWpImages( config ) {
	const { developmentPhpVersion, testsPhpVersion } = getPhpVersions( config );
	return {
		developmentWpImage: `wordpress${
		developmentPhpVersion ? ':php' + developmentPhpVersion : ''
	}`,
		testsWpImage: `wordpress${
		testsPhpVersion ? ':php' + testsPhpVersion : ''
	}`

	}
}

function getCliImages( config ) {
	const { developmentPhpVersion, testsPhpVersion } = getPhpVersions( config );
	return {
		developmentWpCliImage: `wordpress:cli${
		! developmentPhpVersion || developmentPhpVersion.length === 0
			? ''
			: '-php' + developmentPhpVersion
	}`,
		testsWpCliImage: `wordpress:cli${
		! testsPhpVersion || testsPhpVersion.length === 0
			? ''
			: '-php' + testsPhpVersion
	}`
	}
}

function getPhpunitImages( config ) {
	// Defaults are to use the most recent version of PHPUnit that provides
	// support for the specified version of PHP.
	// PHP Unit is assumed to be for Tests so use the testsPhpVersion.
	const { developmentPhpVersion, testsPhpVersion } = getPhpVersions( config );
	let phpunitTag = 'latest';
	const phpunitPhpVersion = '-php-' + testsPhpVersion + '-fpm';
	if ( testsPhpVersion === '5.6' ) {
		phpunitTag = '5' + phpunitPhpVersion;
	} else if ( testsPhpVersion === '7.0' ) {
		phpunitTag = '6' + phpunitPhpVersion;
	} else if ( testsPhpVersion === '7.1' ) {
		phpunitTag = '7' + phpunitPhpVersion;
	} else if ( [ '7.2', '7.3', '7.4' ].indexOf( testsPhpVersion ) >= 0 ) {
		phpunitTag = '8' + phpunitPhpVersion;
	} else if ( testsPhpVersion === '8.0' ) {
		phpunitTag = '9' + phpunitPhpVersion;
	}
	const phpunitImage = `wordpressdevelop/phpunit:${ phpunitTag }`;
	return phpunitImage
}

function shouldInstallXdebug( config ) {
	if ( config.xdebug !== 'off' ) {
		const usingCompatiblePhp = checkXdebugPhpCompatibility( config );

		if ( usingCompatiblePhp ) {
			return true;
			shouldInstallXdebug = true;
		}
	}

	return false;
}

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

module.exports = {
	getPhpVersions,
	getWpImages,
	getCliImages,
	getPhpunitImages,
	shouldInstallXdebug,
	checkXdebugPhpCompatibility
}
