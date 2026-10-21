# 上游 issue / PR 存档

本目录是 **YuJunZhiXue/dsh-purge** 在宣布删库前的 issue / PR 全量快照，
由 [@mmparko](https://github.com/mmparko) 于 2026-10-13 通过 GitHub REST API 抓取。

**原项目一切权利与署名归原作者 YuJunZhiXue。** 原仓库：https://github.com/YuJunZhiXue/dsh-purge

| 文件 | 内容 |
| --- | --- |
| `ISSUES-DIGEST.md` | 人读版：91 个 issue + 24 个 PR 的标题、状态、正文、全部评论（markdown） |
| `issues-and-prs.json` | API 原始响应：issues + PRs 全字段 |
| `issue-comments.json` | 按 issue 编号归类的全部评论（135 条） |
| `repo-metadata.json` | 仓库元数据快照（stars / forks / 描述 / topics / license 等） |
| `labels.json` | 仓库标签定义（10 个） |

## 存档时规模

- issue：**91** 个（终态：open + closed 全部）
- Pull Request：**24** 个
- 评论：**135** 条
- 星标 **4,995** / fork **612**

## 用法

```bash
git clone -b upstream-archive https://github.com/mmparko/dsh-purge.git
cd dsh-purge
less upstream-archive/ISSUES-DIGEST.md

# 在存档里搜关键词
grep -rn "报错关键词" upstream-archive/ISSUES-DIGEST.md | head

# 用 jq 精确查询
jq -r '.[] | select(.state=="open") | "#\(.number) \(.title)"' upstream-archive/issues-and-prs.json
```

## 注意

- 本目录是**只读存档**，不再更新（上游已停止维护、不再收 issue / PR）。
- 存档中出现的用户昵称、头像链接、正文均为原作者与社区贡献者所有，仅作历史留档。
