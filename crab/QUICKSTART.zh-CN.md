# StickS3 螃蟹助手：你需要做什么

代码已实现，已在本机连接的 StickS3 上完成备份、烧录、联网与部分音频/中断/重连测试，并接通真实 DeepSeek。仍需近距离人声、屏幕与电池验收，详见 [测试记录](VALIDATION.md)。首次安装其他设备时，建议先用固定字幕和测试音验证。

## 你先准备三件事

1. 用能传数据的 USB-C 线，把 StickS3 接到这台 Mac。先不要擦除固件，必须备份当前完整 Flash。
2. 为 Pi 选择模型：登录你已有的模型服务，或者配置 Ollama / LM Studio 等本地模型。Pi 不依赖 Muse 订阅，所选云端服务仍可能收费。
3. 准备设备可用的 2.4 GHz Wi-Fi，让 Mac 与 StickS3 能互相访问；Mac 在使用期间保持开机、联网。

密钥和 Wi-Fi 密码请在本机输入，不用发到聊天里。

## 给 Pi 配置模型

在这台 Mac 的终端运行：

```sh
cd /Users/xnu/github/muse/muse-gadget-sdk/crab/bridge
./node_modules/.bin/pi
```

第一次使用其他电脑时，先运行 `npm ci --ignore-scripts`。

如果使用 DeepSeek，可直接在 `crab/bridge` 运行 `python3 ../tools/setup_deepseek.py`，按隐藏提示输入密钥；本机已经配置好了。

使用其他模型服务时，在 Pi 中执行 `/login`，完成模型服务登录，再用 `/model` 选择模型。桥接服务使用 `~/.pi/agent` 的凭据和设置。也可以在 `bridge/.env` 设置 `PI_PROVIDER` 和 `PI_MODEL`，明确指定模型。本地模型按 [Pi 的 models.json 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md) 配置。

## 启动电脑服务，先用 demo 验证

本机已创建被 Git 忽略的 `bridge/.env`，生成了共享 token，并配置了本地语音命令。默认是 demo 模式。其他电脑从 `.env.example` 创建自己的 `.env`，按 README 安装本地语音依赖并填写绝对路径。

编辑 `bridge/.env`：

```dotenv
CRAB_HOST=0.0.0.0
CRAB_DEMO=true
```

`0.0.0.0` 允许局域网中的 StickS3 连接。token 至少 32 字符，设备配置时填写相同值。当前传输是家庭局域网 HTTP，请勿做公网端口转发。

```sh
cd /Users/xnu/github/muse/muse-gadget-sdk/crab/bridge
npm run dev
```

终端保持运行。demo 会返回固定中文字幕与半秒测试音，不会调用模型或真实语音识别。

## 备份、烧录、配置设备

接好设备后，可以让 Codex 完成识别、备份和烧录。手动执行时，在另一个终端运行：

```sh
. /Users/xnu/esp/esp-idf-v6/export.sh
cd /Users/xnu/github/muse/muse-gadget-sdk/crab/firmware
python ../tools/device.py status --port /dev/cu.usbmodemXXXX
python ../tools/device.py backup --port /dev/cu.usbmodemXXXX
```

端口必须使用实际检测结果。备份保存为 `crab/backups/sticks3-TIMESTAMP.bin`，文件包含现有设备凭据，请保留在本机。确认备份成功后：

```sh
idf.py build
python ../tools/device.py flash --port /dev/cu.usbmodemXXXX --file ../backups/sticks3-TIMESTAMP.bin
idf.py -p /dev/cu.usbmodemXXXX monitor
```

启动日志应显示 `Crab standalone starting`，没有 panic 或反复重启。退出 monitor（Ctrl-]）再配置：

```sh
python ../tools/device.py configure --port /dev/cu.usbmodemXXXX
```

按提示输入 SSID、Wi-Fi 密码、电脑服务地址和共享 token。服务地址应使用 Mac 在该网络中的 IP，例如 `http://192.168.1.10:8787`，不要填写 `localhost` 或 `0.0.0.0`。Wi-Fi 密码和 token 输入不会回显。保存后设备重启。

如果首次迁移因旧 NVS 数据无法启动，按 README 的备份核验及 NVS 恢复步骤处理，不要先擦除整块 Flash。

## 验收与开启真实对话

1. 看见螃蟹头像和 Wi-Fi 状态。
2. 按住正面按钮说话，松开后收到固定字幕与测试音。
3. 短按侧面按钮切换字幕页；处理中按正面按钮取消，取消完成后再次按住开始新录音。
4. 检查录音、播放、重连后，再把 `CRAB_DEMO=false`，重启电脑桥接服务。
5. 确认 Pi 模型已登录、本地识别与 TTS 命令有效，再测试“帮我记一下，明天下午三点去取快递”。先比较屏幕上的识别文字与原句。

首次本地识别需要下载 faster-whisper 模型。本机的 small 模型已下载并用合成中文测试；真实麦克风准确度和延迟仍要实测。

当前连续对话只在电脑服务运行期间保留；重启后会忘记。尚未加入持久便签、智能家居等工具，聊天不能被当成已保存提醒。

## 回到原来的 Muse 固件

使用完整备份及对应 SHA256 文件：

```sh
python ../tools/device.py restore --port /dev/cu.usbmodemXXXX --file ../backups/sticks3-TIMESTAMP.bin
```

设备不启动时的 ROM 模式手动恢复见 README。首次硬件联调完成后才能确认录音质量、扬声器、休眠和电池续航。
