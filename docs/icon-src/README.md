# Android 启动图标

把包内 `res/` 合并到模块的 `app/src/main/res/`。如果同一个目录已有同名 WebP 或 XML 图标，请移除对应的旧文件，避免资源重名。

在 `AndroidManifest.xml` 的现有 `<application>` 元素上设置 `android:icon="@mipmap/ic_launcher"`。如果项目已声明 `android:roundIcon`，也把它指向 `@mipmap/ic_launcher`。

API 26 及以上使用自适应图标，由桌面启动器应用设备的圆角、圆形等遮罩。更早的版本使用方形 PNG。纸面在左侧和底部出血，不同遮罩下可见的纸面面积会随桌面形状变化。

| 屏幕密度 | 旧版方形图标 | 自适应图标每层 |
| --- | ---: | ---: |
| mdpi | 48 × 48 px | 108 × 108 px |
| hdpi | 72 × 72 px | 162 × 162 px |
| xhdpi | 96 × 96 px | 216 × 216 px |
| xxhdpi | 144 × 144 px | 324 × 324 px |
| xxxhdpi | 192 × 192 px | 432 × 432 px |

`artwork/` 提供 841 × 841 px 方形原尺寸底稿和 512 × 512 px 导出版。四角被截图的圆角遮住，补齐部分根据周围的渐变和纸面重建。
