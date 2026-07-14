# OpenAI 兼容模型服务

NoteBi 的通用模型提供商使用 OpenAI 兼容协议，用户可以在“设置 → 提供商管理”中配置：

- `kind`: `openai_compatible`
- `base_url`: 服务的 API 根地址，通常以 `/v1` 结尾
- `api_key`: 远端服务要求时填写；本地服务可填写任意占位值
- 在“模型管理”中为对话、视觉、嵌入、重排分别选择模型

客户端只依赖这些标准端点：

- `GET /models`
- `POST /chat/completions`
- `POST /embeddings`（启用知识库检索时）
- `POST /rerank`（配置重排模型时）

## 华为昇腾

以下两类服务都可通过同一个 OpenAI 兼容提供商接入：

```text
Base URL: http://127.0.0.1:8000/v1
API Key:  任意非空占位值（如果本地服务不校验鉴权）
```

- vLLM + `vllm-ascend`：使用 vLLM 的 OpenAI-compatible server，在昇腾设备上加载可用模型。
- MindIE：使用 MindIE 暴露的 Chat Completions 服务地址；如果部署的网关提供 `/models`，模型列表可自动同步，也可以在模型管理中手动填写模型 ID。

注意：不同昇腾部署的 `/models` 返回内容和鉴权策略可能不同。模型发现失败不影响手动填写模型 ID；真正调用时仍会通过同一 `base_url` 发送请求。每个提供商独立携带 Base URL，不修改进程级环境变量，因此同时配置云端和本地昇腾服务不会互相串地址。

参考：

- [vLLM](https://github.com/vllm-project/vLLM)
- [vLLM Ascend](https://github.com/vllm-project/vllm-ascend)
- [MindIE Service 开发指南](https://www.hiascend.com/doc_center/source/zh/mindie/10RC3/mindieservice/servicedev/MindIE%201.0.RC3%20Service%E5%BC%80%E5%8F%91%E6%8C%87%E5%8D%97%2001.pdf)
