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

module.exports = {
	getPhpVersions,
	getWpImages,
	getCliImages,
	getPhpunitImages
}
