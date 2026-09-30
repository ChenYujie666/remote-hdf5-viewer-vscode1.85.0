# Remote HDF5 Viewer

一个兼容 VS Code 1.85+ 的 HDF5 查看器。插件运行在 VS Code Remote SSH 的远程扩展主机中，因此文件和命令都在远程 Linux 服务器上执行，不会先下载整个 HDF5 文件。

## 远程服务器依赖

表格预览需要远端 Python 的 `h5py`：

```bash
python3 -m pip install --user h5py
```

如果仅安装 `hdf5-tools`（提供 `h5ls`），可以浏览文件结构，但点击数据集时无法预览表格。若 `h5py` 安装在 Conda 环境里，请将远程设置 `hdf5Viewer.pythonPath` 指向该环境的 Python 可执行文件。

## 构建

```bash
python scripts/make_vsix.py
```

在 Remote SSH 窗口把 `.vsix` 安装到 SSH 主机。打开 `.h5`、`.hdf5` 或 `.he5` 文件即可浏览结构；点击数据集会用表格显示前 50 行。二维数据最多预览前 50 列，更高维度的后续维度各采样前 4 项，以控制读取量。

如果文件根目录包含一维的 `col_0`、`col_1` 等数据集，打开时会自动把长度最大的所有 `col_N` 放入同一张表，按数字编号排序。每列仅读取前 50 行。表格默认占满编辑区；列数较多时可以横向滚动，点击 **Show tree** 可返回文件结构。
