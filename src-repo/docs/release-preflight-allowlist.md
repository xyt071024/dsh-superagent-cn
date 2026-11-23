# 发布预检（release_preflight.py）第三方误报白名单说明

为保证发布产物不包含真实凭据或敏感配置文件，[`scripts/release_preflight.py`](../scripts/release_preflight.py) 会扫描所有发布包及嵌套归档。对 `@deepseek-ai/dsh` 上游依赖树中的只读静态资源，经逐文件原文核查确认以下命中均为开源库自身文档示例、协议校验常量或上游 DevTools 公开前端遥测字符串，不包含任何本机路径、个人账号或私密凭据：

| 归档相对路径（前缀 `runtime/node_modules/`） | 命中类型 | 原文核查结论 |
| --- | --- | --- |
| `@deepseek-ai/dsh-experimental-inspector/lib/devtools/chunks/legacy-dM_vujv7.js` | `credential in URL` | Chrome DevTools 前端混淆资源中的本地化测试域名串匹配，无真实凭据 |
| `@deepseek-ai/dsh-experimental-inspector/lib/devtools/entrypoints/lighthouse_worker/lighthouse_worker.js` | `credential in URL` | Chromium Lighthouse 上游内置公开遥测 DSN（`sentry.io/174697`） |
| `@deepseek-ai/dsh-experimental-inspector/lib/devtools/models/issues_manager/descriptions/corsRedirectContainsCredentials.md` | `credential in URL` | 文档示例 URL：`https://username:password@example.com` |
| `@opentelemetry/semantic-conventions/dist/{experimental_attributes,stable_attributes,trace/SemanticAttributes}.{cjs,mjs,d.cts,d.mts}` 及对应 `.map` | `credential in URL` | OpenTelemetry 规范注释中的示例与脱敏样例 URL（`username:password@www.example.com` / `REDACTED:REDACTED@www.example.com`） |
| `http2-wrapper/README.md` | `credential in URL` | README 代理示例：`https://username:password@localhost:8000` |
| `jose/dist/webapi/key/import.js` | `private key` | PKCS8 格式校验前缀字符串字面量 `'-----BEGIN PRIVATE KEY-----'`，非真实私钥 |
| `normalize-url/index.d.ts`, `normalize-url/readme.md` | `credential in URL` | README / 类型注释示例：`https://user:password@sindresorhus.com` |

## 约束策略

1. 仅按「精确归档相对路径 + 精确命中类型」放行，不使用宽泛目录通配。
2. 若上述文件出现其他类型的告警（如 GitHub Token、API Key），或任何其他路径出现上述告警，预检仍立即阻断发布。
3. Windows Bundled 包已在打包阶段通过 `stageNode()` 裁剪 `node_modules/npm` 与 `node_modules/corepack`，因此 `node/node_modules/npm/.npmrc` 等文件不再打入产物，无需也不得加入白名单。
