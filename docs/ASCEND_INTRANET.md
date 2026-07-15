# 华为昇腾内网部署说明

## 设计边界

NoteBi 的昇腾支持采用“可配置模型服务地址”方式：NoteBi 负责本地界面、素材处理和笔记工作流，昇腾节点负责 Chat、Embedding、Rerank 等模型推理。

本方案不修改现有 provider 配置结构，不改模型名，不把昇腾地址硬编码进源码，也不把 API Key 写入发行包。

```text
Windows NoteBi 懒人包
        │
        │  内网 OpenAI-compatible HTTP API
        ▼
昇腾 Linux 节点
  ├── 驱动 / 固件
  ├── CANN
  ├── vLLM-Ascend 或 MindIE
  └── 已准备好的模型权重
```

当前 vLLM Ascend 官方项目的环境边界主要是 Linux、CANN、PyTorch 和 torch-npu，因此不把它塞进通用 Windows runtime。请以实际昇腾卡型、驱动、CANN 和模型兼容矩阵为准：[vLLM Ascend 官方仓库](https://github.com/vllm-project/vllm-ascend)。

## 内网无下载流程

在可联网的构建环境完成：

1. 固定 Python、CANN、驱动、推理框架和模型版本。
2. 下载并验证全部安装包、容器镜像或离线 wheel。
3. 下载模型权重并记录 SHA256、模型许可证和来源。
4. 在隔离环境启动模型服务，验证 `/v1/models` 和 `/v1/chat/completions`。
5. 通过批准的介质把安装包、模型和清单带入内网。
6. 内网只使用本地文件安装和本地模型路径，不执行在线安装命令。

CANN 官方提供离线安装路径，可参考：[CANN 离线安装场景](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/850/softwareinst/instg/instg_0000.html)。

## NoteBi 中的配置

Windows 包启动后打开：

```text
设置 → 模型与渠道
```

为 Chat、Embedding、Rerank 分别填写：

- 类型：OpenAI-compatible
- 地址：内网模型服务的 `/v1` 地址
- 模型名：昇腾服务实际暴露的模型名
- API Key：如果内网服务不需要，可按现有配置留空；如果需要，只保存在本机设置中

示例地址仅用于说明格式：

```text
http://10.0.0.20:8000/v1
```

不要把真实内网 IP、API Key、模型权重或内部证书提交到公开 GitHub。

## 验收清单

- [ ] Windows 包可以在断网状态通过预检并启动。
- [ ] 本地 ASR 使用包内缓存，不触发模型下载。
- [ ] 说话人模型从包内目录加载。
- [ ] Chat 总结可以访问内网昇腾服务。
- [ ] Embedding / Rerank 可以访问对应内网服务。
- [ ] 断开内网模型服务时，NoteBi 显示可理解的错误，不影响打开已有笔记。
- [ ] 模型、驱动、CANN 和推理框架版本已记录并可复现。
