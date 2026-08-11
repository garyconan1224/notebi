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
