# 项目级知识与规范 (Project Memory & Guidelines)

## 1. 基础设施与服务器信息 (Infrastructure & Server Memory)
- **服务器 IP**：`211.149.160.114`
- **SSH 端口**：`22000`
- **登录用户**：`root`
- **SSH 私钥文件**：`ssh-root-211-149-160-114-port22000.key`（位于项目根目录，权限需保持 `600`）
- **核心连接命令**：
  ```bash
  ssh -i ssh-root-211-149-160-114-port22000.key -p 22000 -o StrictHostKeyChecking=no root@211.149.160.114
  ```

## 2. 域名与服务矩阵对应关系 (Domains & Deployment Matrix)
本服务器同时承载了以下两套业务系统：
1. **`www.haoxiu.com`**（当前项目 `wanjing` - 万镜门户与核心计费）:
   - **本地路径**：`/Volumes/extre/proj/wanjing`
   - **服务器路径**：`/home/qingheng/wanjing`
   - **PM2 进程**：`wanjing-web` (ID 5)
   - **数据库路径**：`/home/qingheng/wanjing/data/wanke.db`
2. **`token.haoxiu.com`**（兄弟项目 `bailianapi` - 青衡平台 / API 服务与控制台）:
   - **本地路径**：`/Volumes/extre/proj/bailianapi`
   - **服务器路径**：`/home/qingheng/app`
   - **PM2 进程**：`qingheng-api`、`qingheng-worker`、`qingheng-web`
   - **部署脚本**：`/Volumes/extre/proj/bailianapi/scripts/deploy.sh`

## 3. 操作与安全守则 (Security & Operational Rules)
- **私钥安全**：严禁将私钥文件提交至公开代码仓库或输出到外部日志中。
- **数据防护**：远程执行更新或数据库操作前，务必对 SQLite 数据库 (`wanke.db`) 及环境配置进行备份。
- **用户反馈原则**：任何操作均需向用户提供明确的进展与结果反馈（成功、失败、处理中），禁止静默操作；破坏性操作须经确认。
