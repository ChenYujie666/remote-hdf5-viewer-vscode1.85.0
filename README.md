# Remote HDF5 Viewer

一个兼容 VS Code 1.85+ 的 HDF5 查看器。插件运行在 VS Code Remote SSH 的远程扩展主机中，因此文件和命令都在远程 Linux 服务器上执行，不会先下载整个 HDF5 文件。

## 远程服务器依赖

推荐安装 `hdf5-tools`（提供 `h5ls`）：

```bash
sudo apt install hdf5-tools
```

如果没有 `hdf5-tools`，插件会尝试使用 `python3` + `h5py`。

## 构建

```bash
npx @vscode/vsce package --allow-missing-repository
```

然后在本地 VS Code 或 Remote SSH 窗口安装生成的 `.vsix`。打开 `.h5`、`.hdf5` 或 `.he5` 文件即可浏览结构，点击 dataset 会读取前 100 个元素。
