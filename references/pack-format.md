# 可移植角色包

完整包示例：

```text
ip-packs/ahe/
  character.json
  character-spec.md
  generation-log.json
  review.md
  images/
    front.png
    turnaround.png
    cutout.png
```

名字只是格式示例，不代表自动创建阿禾。图片按实际请求交付：头像包可只有 portrait；缺少的图不建空文件。已有同名目录用新版本，不覆盖。

## character.json

```json
{
  "schemaVersion": 1,
  "id": "ahe",
  "displayName": "阿禾",
  "status": "draft",
  "inputKind": "text",
  "style": "柔和立体插画",
  "license": "not-specified",
  "approval": {"status": "pending", "note": "等待预览确认"},
  "lockedFeatures": ["具体身份特征", "具体服装结构和配件侧别"],
  "assets": {
    "front": "images/front.png",
    "turnaround": "images/turnaround.png",
    "cutout": "images/cutout.png"
  },
  "characterSpec": "character-spec.md",
  "generationLog": "generation-log.json",
  "review": "review.md"
}
```

`id` 用小写英文、数字和短横线，最长 64 字符。`inputKind` 为 `photo`、`character` 或 `text`。`status` 为 `draft`、`ready`、`needs-revision`。`approval.status` 为 `pending`、`confirmed` 或 `delegated`；确认和委托的依据简要写在 note，不能伪造用户确认。`ready` 仅用于所有实际请求的交付和检查已完成且预览已获确认或有效委托。

`assets` 允许 `front`、`turnaround`、`cutout`、`portrait`，至少一项；值为实际文件的相对路径。所有记录文件必须在包内，禁止绝对路径、`..`、指向包外的符号链接。不保存真人输入照片、账户或本机路径。许可未知使用 `not-specified`；它不是对外许可。

## character-spec.md

让下一次拿到包的人能看懂：

- 人物身份、用途、风格与比例。
- 固定面部特征、发型、服装和配件侧别。
- 近似配色及材质；说明它们不是像素测色结果。
- 允许变化和禁止漂移的项目。
- 三视图位置／朝向说明及本次补全的不可见结构。
- 一段可复用的身份提示词；引用实际图像路径。
- 来源、许可状态，以及存在的限制。

用户原照片不写入规范。生成图可以做下一次的身份参考，但不能因此声称真人授权已经永久转授。

## generation-log.json

使用 `schemaVersion: 1` 和非空 `steps` 数组。每一步记录 `id`、`tool`、`model`、`intent`、`prompt`、`references`、`output`、`result`。其中 `model` 未被工具报告时写 `not-reported`；`references` 是包内实际提交的生成参考图路径数组；`output` 是包内输出路径；`result` 为 `succeeded` 或 `failed`。失败步骤不要捏造输出文件，output 设为 null。

真人照片只记录 `source-photo-session-input` 这样的输入类型说明，不复制照片，也不写原路径；此标记只允许在 inputDescription 文字字段中，不能冒充包内参考文件。用已有参考角色时注明来源授权依据。不要保存临时下载地址、密钥、对话私密内容或带认证的 URL。

## review.md

逐项记 `通过`、`未通过`、`不可见` 或 `未检查`：身份、服装、侧别、严格侧面／背面、头脚完整、文件可读和透明像素。给出具体观察，不写笼统“100%一致”。明确人工视觉检查、自动检查和用户认可分别是谁完成的。

检查器退出码：0 为文件与结构检查通过；1 为数据／图片存在问题；2 为命令用法错误。检查通过不代表视觉或权利通过。检查器不生成、编辑、删除任何文件，也不联网。
