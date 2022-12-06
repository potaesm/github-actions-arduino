const core = require('@actions/core');
const github = require('@actions/github');

const fs = require('fs-extra');
const path = require('path');

const express = require('express');
const localtunnel = require('localtunnel');
const mqtt = require('mqtt');
const axios = require('axios');

// const mqttConfig = {
// 	url: 'mqtt://puffin.rmq2.cloudamqp.com',
// 	options: {
// 		username: 'gwbvwhzr:gwbvwhzr',
// 		password: 'BH4UyDm74GHbzdsYJOFtvZL7LTIM_bNB'
// 	},
// 	topic: 'main/update'
// };

const STAGE = {
	BIN_URL_SENT: 'BIN_URL_SENT',
	BIN_URL_RECEIVED: 'BIN_URL_RECEIVED',
	UPDATE_FAILED: 'UPDATE_FAILED',
	UPDATE_OK: 'UPDATE_OK',
	TIMEOUT: 'TIMEOUT'
};

function openFileServer(binaryPath = '') {
	return new Promise(async (resolve, reject) => {
		try {
			const port = 3001;
			const app = express();
			app.use(express.json());
			app.get('/', (request, response) => response.download(binaryPath));
			const server = app.listen(port);
			const tunnel = await localtunnel({ port });
			// const tunnel = { url: 'localhost' };
			let retry = 10;
			while (!!retry) {
				try {
					await axios({
						method: 'get',
						url: tunnel.url.replace('https://', 'http://')
					});
					retry = 0;
				} catch (error) {
					retry--;
				}
			}
			return resolve({ server, tunnel });
		} catch (error) {
			return reject(error);
		}
	});
}

function closeFileServer(server = require('express')().listen(), tunnel = require('localtunnel')()) {
	return new Promise(async (resolve, reject) => {
		try {
			tunnel.close();
			return server.close((error) => {
				if (!!error) reject(error);
				resolve();
			});
		} catch (error) {
			return reject(error);
		}
	});
}

function startDeployment(deployOptions, monitorStage = (stage = '') => {}) {
	return new Promise((resolve, reject) => {
		try {
			const { deviceId, commitId, binUrl, mqttConfig, timeLimit } = deployOptions;
			const client = mqtt.connect(mqttConfig.url, mqttConfig.options);
			const timeout = setTimeout(() => {
				clearTimeout(timeout);
				client.publish(mqttConfig.topic, null, { retain: true, qos: 2 });
				client.end();
				reject(new Error(STAGE.TIMEOUT));
			}, timeLimit || 120000);
			client.on('connect', function () {
				client.subscribe(mqttConfig.topic, function (error) {
					if (error) {
						reject(error);
					} else {
						client.publish(mqttConfig.topic, JSON.stringify({ id: deviceId, commit: commitId, url: binUrl.replace('https://', 'http://'), stage: STAGE.BIN_URL_SENT }), { retain: true, qos: 2 });
					}
				});
			});
			client.on('message', function (topic, message) {
				const { id, commit, stage } = JSON.parse(message.toString() || '{}');
				if (topic === mqttConfig.topic && id === deviceId && commit === commitId) {
					monitorStage(stage);
					if (stage !== STAGE.BIN_URL_SENT && stage !== STAGE.BIN_URL_RECEIVED) {
						client.publish(mqttConfig.topic, null, { retain: true, qos: 2 });
						client.end();
						if (stage === STAGE.UPDATE_OK) {
							resolve(stage);
						} else if (`${stage}`.startsWith(STAGE.UPDATE_FAILED)) {
							reject(new Error(stage));
						}
					}
				}
			});
		} catch (error) {
			return reject(error);
		}
	});
}

function monitorStage(stage = '') {
	console.log('Deployment stage: ', stage);
}

(async function () {
	try {
		const commitId = github.context.payload.head_commit?.id;
		const deviceId = core.getInput('deviceId');
		const binaryBuildPath = core.getInput('binaryBuildPath');
		const timeLimit = core.getInput('timeLimit');
		const mqttUrl = core.getInput('mqttUrl');
		const mqttUsername = core.getInput('mqttUsername');
		const mqttPassword = core.getInput('mqttPassword');
		const mqttTopic = core.getInput('mqttTopic');
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
		const { server, tunnel } = await openFileServer(path.join(binaryBuildPath, binaryFileName));
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
			return core.setOutput('result', result);
		}
		return core.setFailed(new Error(result));
	} catch (error) {
		return core.setFailed(error);
	}
})();
