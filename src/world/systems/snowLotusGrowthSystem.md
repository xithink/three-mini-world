# 天山雪莲生长系统

实现文件：`src/world/systems/snowLotusGrowthSystem.js`

## 真实依据

本系统按天山雪莲 `Saussurea involucrata` 做近似模拟：

- Horticulture Research 2023 雪莲基因组论文记录其生长于天山和阿尔泰山约 2400-4100 m 的高山岩缝环境，并说明从种子萌发到开花约需 6-8 年。  
  https://academic.oup.com/hr/article/10/10/uhad180/7260840
- Flora of China 记录 `Saussurea involucrata` 的高海拔分布范围，并指出其受过度采集威胁。  
  https://www.efloras.org/florataxon.aspx?flora_id=2&taxon_id=200024418
- 中文植物资料常见记录其花果期为 7-9 月，生境包括高山山坡、山谷、水边、草地和岩缝。  
  https://www.iplant.cn/info/Saussurea%20involucrata

## 状态与贴图

| 状态 | 最早年龄 | 状态效果 | 贴图 |
| --- | ---: | --- | --- |
| 休眠种子 | 0 天 | 低温休眠，等待融雪水分 | `/assets/textwatersnowlotus-seed.svg` |
| 萌发芽 | 35 天 | 幼根形成，怕干旱与夜冻 | `/assets/textwatersnowlotus-sprout.svg` |
| 幼年莲座 | 120 天 | 贴地莲座，缓慢积累根系 | `/assets/textwatersnowlotus-rosette-young.svg` |
| 成熟莲座 | 2 年 | 多年生蓄能，冬季休眠 | `/assets/textwatersnowlotus-rosette-mature.svg` |
| 花苞期 | 6-8 年 | 达到繁殖年龄后，仅 7-9 月推进 | `/assets/textwatersnowlotus-bud.svg` |
| 开花期 | 花苞后约 28 天 | 授粉窗口，冷凉晴昼最优 | `/assets/textwatersnowlotus-bloom.svg` |
| 结实散种 | 开花后约 42 天 | 种子成熟并向附近雪山格扩散 | `/assets/textwatersnowlotus-fruit.svg` |
| 枯死残株 | 繁殖后或受压死亡 | 停止生长，保留残株状态 | `/assets/textwatersnowlotus-dead.svg` |

每株雪莲生成时会得到一个 `flowerReadyDays`，随机落在 `6-8 年` 之间，避免所有植株同一天开花。

## 每 tick 流程

1. `update(deltaTime)` 每帧执行一次，等价于本系统的 tick。
2. 从 `time:update` 折算真实世界日数增量，支持 HUD 的 `+1d`、`+1mo` 时间跳转。
3. 扫描已加载 chunk，并同步新增/卸载 chunk 的雪莲 Sprite。
4. 每株雪莲每 tick 重新检测地形、表面方块、水源、昼夜、季节、天气、温度、湿度、土壤水分、积雪和海拔。
5. 类型筛选：表面方块必须是 `BLOCK_IDS.SNOW_MOUNTAIN`，否则立刻转为枯死。
6. 根据适生度恢复健康、积累阶段进度；根据环境胁迫扣健康。
7. 当年龄门槛、季节窗口、阶段进度都满足后，用概率推进到下一状态。
8. 结实散种阶段按概率向附近雪山格生成新种子。

## 环境关系

只允许雪山生长：

```js
surfaceBlockId === BLOCK_IDS.SNOW_MOUNTAIN
```

环境检测字段：

- `water`：半径 6 格内水源距离换算，近水但不贴水最优
- `daylight`：由昼夜阶段和季节日照时长计算
- `temperatureCelsius`：季节基础温度 + 天气偏移 + 昼夜偏移 - 海拔降温 - 积雪降温
- `humidity`：生态湿度 + 天气 + 水源 + 积雪 - 热干燥
- `soilMoisture`：水源、湿度、融雪水、排水共同决定
- `snowCoverage`：生态积雪、高海拔和下雪天气共同决定
- `altitudeM`：由 voxel 表面高度映射到约 2400-4300 m 区间

## 概率规则

适生度：

```text
suitability =
  realAltitudeScore *
  (
    altitudeScore * 0.12 +
    waterScore * 0.14 +
    humidityScore * 0.14 +
    soilMoistureScore * 0.16 +
    daylight * 0.10 +
    drainageScore * 0.08 +
    seasonScore * 0.12 +
    temperatureScore * 0.14
  )
```

阶段进度：

```text
stageProgress +=
  worldDays *
  stageDailyProgress *
  growthPotential *
  (0.64 + health * 0.36)
```

阶段推进概率：

```text
chance =
  1 - (1 - dailyChance * suitability * health * vigor * randomGate) ^ worldDays
```

硬门槛：

- `bud` 必须达到个体繁殖年龄 `flowerReadyDays`，即 6-8 年。
- `bud`、`bloom`、`fruit` 必须处于 7-9 月花果期窗口。
- 非雪山方块不参与自然生成，已存在雪莲如果地形变化为非雪山会死亡。

## 接入点

`createMiniWorld.js` 中注册：

```js
const snowLotusGrowthSystem = new SnowLotusGrowthSystem({ scene, eventBus, worldManager });
snowLotusGrowthSystem.update(deltaTime);
```

悬停 HUD 会显示雪莲状态、年龄周期、健康、适生度、水、光、湿、摄氏温度、土壤水分和积雪覆盖。
