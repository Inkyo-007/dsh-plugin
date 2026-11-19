# dsh-plugin

Inkyo 的 DeepSeek Harness 插件合集。

## 插件列表

| 目录 | 包名 | 说明 |
|---|---|---|
| [archify/](archify/) | `@tt-a1i/archify-dsh` | Archify 架构图技能（上游 npm 包 1.1.0 的本地副本，附带中文界面元数据） |
| [fluent/](fluent/) | `@local/dsh-fluent` | Fluent 个人 AI 语言家教 preset |

## 作为插件市场使用

索引文件为仓库根目录的 [index.json](index.json)，在 DSH 中添加索引源：

1. 打开 **插件（Plugins）** 页面 → **Discover / 发现** 标签页；
2. 点击 **Add index source（添加索引源）**；
3. 填入（无跳转的 raw 直链）：

   ```
   https://raw.githubusercontent.com/Inkyo-007/dsh-plugin/main/index.json
   ```

之后即可在 Discover 页浏览、安装本仓库收录的插件。每个插件的 Git 源钉死在具体 commit 上，索引不更新则装到的版本不变。

## 维护工作流

日常只需正常提交和推送，索引会自动更新：

```bash
git commit -am "feat: ..."
git push        # pre-push 钩子自动重生成 index.json，如有变化自动补一个 chore 提交
```

合并分支进 `main` 时，`post-merge` 钩子做同样的事。

### hooks 安装（新机器 clone 后必做）

`core.hooksPath` 是本地配置，不随克隆分发：

```bash
git config core.hooksPath .githooks
```

### 手动重新生成索引

```bash
node scripts/build-index.mjs   # 仓库地址依次取：--repo 参数 → $DSH_INDEX_REPO → origin 远程
```

### 注意事项

- **不要改写已推送的历史**（rebase / amend / force-push）：索引中的 `source.commit` 钉死了 commit，历史被改写后旧索引条目会失效。必须改写时，改完重跑一次生成器。
- `index.json` 由脚本生成，不要手工编辑。
- 新增插件：在仓库根目录新建包含 `package.json`（声明 `dsh.bundle.patch`）的目录即可，下次推送时自动进索引。
