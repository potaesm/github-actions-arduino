const fs = require('fs-extra');
const path = require('path');
const { STAGE, openFileServer, closeFileServer, startDeployment, monitorStage, timeDiff } = require('./index');

function generateReport(startDate = new Date(), result = '', fileName = 'test-report.txt') {
	const os = require('os');
	fs.open(fileName, 'a+', function (e, fd) {
		if (!!e) return console.error(e);
		const endDate = new Date();
		const log = [endDate.toLocaleString('en-GB').split(', ').join(' ')];
		const { minutes, seconds } = timeDiff(startDate, endDate);
		log.push(`Total: ${minutes}m ${seconds}s`);
		log.push('Result: ' + result + os.EOL);
		fs.write(fd, log.join(', '), null, 'utf8', function () {
			fs.close(fd, function () {
				console.log('Report generated');
			});
		});
	});
}

(async function () {
	try {
		const startDate = new Date();
		const commitId = 'COMMIT_ID';
		const deviceId = 'DEVICE_ID';
		const binaryBuildPath = './';
		const timeLimit = 300000;
		const mqttUrl = 'mqtt://puffin.rmq2.cloudamqp.com';
		const mqttUsername = 'gwbvwhzr:gwbvwhzr';
		const mqttPassword = 'BH4UyDm74GHbzdsYJOFtvZL7LTIM_bNB';
		const mqttTopic = 'main/update';
		const tunnelUrlFilePath = 'tunnelUrl.txt';
		const fileServerPort = 3001;
		const mqttConfig = {
			url: mqttUrl,
			options: {
				username: mqttUsername,
				password: mqttPassword
			},
			topic: mqttTopic
		};
		const buildFiles = await fs.readdir(binaryBuildPath);
		console.log('Build files: ', buildFiles);
		const binaryFileName = buildFiles.find((fileName) => fileName.includes('.bin'));
		console.log('Binary file name: ', binaryFileName);
		console.log('Opening file server...');
		let tunnelUrl = '';
		// tunnelUrl = 'localhost';
		if (!!tunnelUrlFilePath && !tunnelUrl) {
			tunnelUrl = await fs.readFile(tunnelUrlFilePath, 'utf8');
		}
		const { server, tunnel } = await openFileServer(path.join(binaryBuildPath, binaryFileName), tunnelUrl, fileServerPort);
		console.log('Binary file is served at ', tunnel.url);
		console.log('Starting deployment...');
		let result = '';
		try {
			result = await startDeployment({ deviceId, commitId, binUrl: tunnel.url, mqttConfig, timeLimit }, monitorStage);
		} catch (error) {
			result = error?.message || `${error}`;
		}
		console.log('Deployment result: ', result);
		console.log('Closing file server...');
		await closeFileServer(server, tunnel);
		console.log('File server closed');
		if (result === STAGE.UPDATE_OK) {
			generateReport(startDate, result);
			return console.log('result', result);
		}
		return console.error(new Error(result));
	} catch (error) {
		return console.error(error);
	}
})();
