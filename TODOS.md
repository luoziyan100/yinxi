# TODOS

## 为 `migrateOldConfig()` 添加输入验证

**优先级：** 低
**文件：** `src/config.ts:44-63`

当配置文件有 `providers` 字段但格式错误时，`migrateOldConfig()` 直接 `as unknown as YinxiConfig`，不做任何检查。用户手动编辑配置文件写错格式时会导致运行时崩溃而不是给出有用的错误提示。

**下一步：** 在 `migrateOldConfig()` 末尾加基本的字段检查（active 是否为 string，providers 是否为 object），无效时降级为空配置并打印警告。
