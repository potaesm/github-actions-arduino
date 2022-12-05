# Arduino Continuous Deployment over MQTT and HTTP

## Inputs

### `deviceId`

**Required** To be deployed device id. Default `""`.

### `binaryBuildPath`

Path to binary build folder. Default `"/home/runner/sketch/build/"`.

### `timeLimit`

Deployment time limit in ms. Default `120000` (2 minutes).

## Outputs

### `result`

Deployment result.

## Example usage

```yaml
on: [push]

jobs:
  hello_world_job:
    runs-on: ubuntu-latest
    name: Node MCU Build & Deploy
    steps:
      - name: Check out repo
        uses: actions/checkout@v2.5.0
      - name: Compile .ino
        uses: ArminJo/arduino-test-compile@v3
        with:
          sketch-names: sketch.ino
          sketch-names-find-start: Sketches/
          arduino-board-fqbn: esp8266:esp8266:nodemcuv2
          platform-default-url: http://arduino.esp8266.com/stable/package_esp8266com_index.json
          set-build-path: true
      - name: Deploy
        id: deployment
        uses: potaesm/github-actions-arduino@v1.1.4
        with:
          deviceId: 'DEVICE_ID'
      - name: Get Result
        run: echo "The deployment was ${{ steps.deployment.outputs.result }}"
```