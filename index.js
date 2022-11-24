const core = require('@actions/core');
const github = require('@actions/github');
const express = require('express');
const localtunnel = require('localtunnel');
const { Observable } = require('rxjs');
const fs = require('fs-extra');
const path = require('path');

const mqtt = require('mqtt');
const axios = require('axios');

const _STAGE = {
	BIN_URL_SENT: 'BIN_URL_SENT',
	BIN_URL_RECEIVED: 'BIN_URL_RECEIVED',
	BIN_DOWNLOADING: 'BIN_DOWNLOADING',
	BIN_DOWNLOADED: 'BIN_DOWNLOADED',
	BIN_DOWNLOAD_FAILED: 'BIN_DOWNLOAD_FAILED',
	UPDATING: 'UPDATING',
	UPDATED: 'UPDATED',
	UPDATE_FAILED: 'UPDATE_FAILED',
	RESTARTING: 'RESTARTING',
	STARTED: 'STARTED',
	TIMEOUT: 'TIMEOUT'
};

const STAGE_UPDATE = {
	BIN_URL_RECEIVED: 'BIN_URL_RECEIVED',
	UPDATE_OK: 'UPDATE_OK'
};

const STAGE_LOG = {
	BIN_URL_SENT: 'BIN_URL_SENT',
	TIMEOUT: 'TIMEOUT',
	UPDATE_SUCCESSFUL: 'UPDATE_SUCCESSFUL',
	UPDATE_UNSUCCESSFUL: 'UPDATE_UNSUCCESSFUL',
	COMPLETE: 'COMPLETE'
};

const mqttConfig = {
	url: 'mqtt://puffin.rmq2.cloudamqp.com',
	options: {
		username: 'gwbvwhzr:gwbvwhzr',
		password: 'BH4UyDm74GHbzdsYJOFtvZL7LTIM_bNB'
	},
	topic: 'main/update'
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
			let retry = 3;
			while (!!retry) {
				try {
					await axios({
						method: 'get',
						url: tunnel.url
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

function deployBinary(deployOptions = { deviceId: '', commitId: '', binUrl: '', mqttConfig: {}, timeLimit: 0 }) {
	return new Observable((subscriber) => {
		try {
			const { deviceId, commitId, binUrl, mqttConfig, timeLimit } = deployOptions;
			const timeout = setTimeout(() => {
				clearTimeout(timeout);
				subscriber.error(STAGE_LOG.TIMEOUT);
			}, timeLimit || 180000);
			const client = mqtt.connect(mqttConfig.url, mqttConfig.options);
			client.on('connect', function () {
				client.subscribe(mqttConfig.topic, function (error) {
					if (error) {
						subscriber.error(error);
					} else {
						client.publish(mqttConfig.topic, JSON.stringify({ id: deviceId, commit: commitId, url: binUrl.replace('https://', 'http://') }), { qos: 2 });
						subscriber.next(STAGE_LOG.BIN_URL_SENT);
					}
				});
			});
			client.on('message', function (topic, message) {
				const { id, commit, stage } = JSON.parse(message.toString());
				console.log({ id, commit, stage });
				if (topic === mqttConfig.topic) {
					// if (!Object.values(STAGE_UPDATE).includes(stage)) {
					// 	subscriber.error(new Error(stage));
					// }
					subscriber.next(stage);
					if (stage === STAGE_UPDATE.UPDATE_OK) {
						client.end();
						subscriber.next(STAGE_LOG.UPDATE_SUCCESSFUL);
						subscriber.complete();
					}
				}
			});
		} catch (error) {
			subscriber.error(error);
		}
	});
}

function startDeployment(deployOptions, monitorStage = (stage = '') => {}) {
	return new Promise((resolve, reject) => {
		try {
			deployBinary(deployOptions).subscribe({
				next: monitorStage,
				error: (error) => resolve(error.message),
				complete: () => resolve(STAGE_LOG.COMPLETE)
			});
		} catch (error) {
			return reject(error);
		}
	});
}

function monitorStage(stage = '') {
	console.log('Deployment Stage: ', stage);
}

(async function () {
	try {
		const commitId = github.context.payload.head_commit?.id;
		const deviceId = core.getInput('deviceId');
		const binaryBuildPath = core.getInput('binaryBuildPath');
		const buildFiles = await fs.readdir(binaryBuildPath);
		const binaryFileName = buildFiles.find((fileName) => fileName.includes('.bin'));
		const { server, tunnel } = await openFileServer(path.join(binaryBuildPath, binaryFileName));
		// const result = await startDeployment({ deviceId, commitId, binUrl: tunnel.url, mqttConfig }, monitorStage);
		return deployBinary({ deviceId, commitId, binUrl: tunnel.url, mqttConfig }).subscribe({
			next: monitorStage,
			error: (error) => core.setFailed(error),
			complete: () => core.setOutput('result', STAGE_LOG.COMPLETE)
		});
		// await closeFileServer(server, tunnel);
		// return core.setOutput('result', result);
	} catch (error) {
		return core.setFailed(error);
	}
})();
