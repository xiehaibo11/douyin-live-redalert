# 直播事件协议

此文档区分当前可运行的模拟接口和待实现的真实抖音适配。入口实现为 [`live-interaction-runtime.mjs`](../scripts/live-interaction-runtime.mjs)，浏览器消费者为 [`LiveInteractionTester.ts`](../src/tools/LiveInteractionTester.ts)。

**尚未接入真实抖音数据；Windows 实机和长时间高兵力压力测试未做。**

## 当前 HTTP 接口

默认基址为 `http://127.0.0.1:4189/api/live-interaction`。开发页面通过 Vite 代理访问同样的路径。

| 方法与路径 | 输入 | 行为 |
| --- | --- | --- |
| `GET /status` | 无 | 返回事件服务状态 |
| `GET /events` | 无 | SSE，建立连接后先发送 `status`，随后发送实时事件 |
| `POST /connect` | `{"mode":"mock"}` | 启用模拟事件会话；`live` 模式当前返回错误 |
| `POST /disconnect` | `{}` | 禁用模拟事件输入；已建立的 SSE 连接仍可接收状态 |
| `POST /mock` | 事件对象 | 校验后广播 `interaction`，再广播 `status`；响应为服务状态 |

POST 使用 JSON 对象。请求体上限为 16 KiB；未知接口返回 404，错误方法返回 405，非法输入返回 400，禁用会话后发送模拟事件返回 409。服务限制本机主机名和请求来源，未开放通用跨域 API。

初始状态为模拟模式已就绪、`sessionActive=false`；连接或首次成功发送模拟事件会激活会话。`eventCount` 是服务进程内累计广播次数，不是本局计分次数，结算期间被浏览器忽略的事件也可能计入服务次数。

## 模拟请求

PowerShell 示例，先启动 `bun run live:start` 并打开游戏页面：

```powershell
$base = "http://127.0.0.1:4189/api/live-interaction"
$body = @{
    kind = "gift"
    openId = "demo-viewer-001"
    uname = "礼物测试观众"
    giftName = "测试礼物"
    giftNum = 2
    price = 1
    totalPrice = 2
} | ConvertTo-Json
Invoke-RestMethod -Uri "$base/mock" -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

该示例的本次礼物总价值为 2 抖币，当前贡献倍率下计 20000 礼物分。它是模拟请求，不产生平台礼物交易。

| 字段 | 类型及当前含义 |
| --- | --- |
| `kind` | 必填，支持 `room-enter`、`like`、`gift`、`guard`、`super-chat`、`danmaku`、`live-start`、`live-end` |
| `openId` | 字符串观众身份，名称沿用历史类型，不要求是某个平台的 OpenID |
| `uname` | 展示昵称，可修改，不作为真实身份依据 |
| `message` | 弹幕正文 |
| `giftName` | 礼物展示名称 |
| `giftNum` | 本次礼物数量，接入采集器时必须使用增量 |
| `price` | 本次礼物的单个抖币价值 |
| `totalPrice` | 本次礼物总抖币价值；存在时优先于 `price × giftNum` |
| `likeCount` | 本次点赞数量，贡献分使用该值；演示出兵另有单事件上限 |
| `guardLevel` | 上游 B 站演示遗留字段，不参与当前三类贡献计分 |

四个字符串字段 `openId`、`uname`、`message`、`giftName` 的长度上限为 500；数值字段必须是 0 到 1000000 的安全整数。贡献规则还会检查乘积和累计分的安全范围。未知的请求字段不会原样透传；客户端传入的 `id`、`cmd` 和 `timestamp` 不控制服务生成的值。

模拟模式缺失 `openId` 时会生成 `mock:昵称`，仅用于方便演示。真实接入必须使用稳定的上游用户 ID，不能继续依赖这个回退，否则同名观众会被合并。

## SSE 输出

```text
event: interaction
data: {"id":"生成的UUID","kind":"gift","cmd":"gift","timestamp":1794184950000,"openId":"demo-viewer-001","uname":"礼物测试观众","giftNum":2,"price":1,"totalPrice":2}

event: status
data: {"mode":"mock","connected":true,"connecting":false,"sessionActive":true,"eventCount":1,"lastError":null,"lastEventAt":1794184950000,"anchor":null}
```

`id` 是服务生成的唯一事件 ID，`timestamp` 为接收时的 Unix 毫秒时间戳，`cmd` 当前与 `kind` 相同。每 15 秒发送一次 SSE 保活注释。当前没有历史回放、消费确认或断线补发。

浏览器仅在 `running` 阶段消费互动事件，丢弃早于本局开始时间的事件，并保留最近最多 5000 个事件 ID 做去重。这里是本局边界保护，不能替代未来采集适配器的重连去重策略。

## 贡献与出兵的区别

只有 `like`、`danmaku`、`gift` 参与当前贡献计算，规则见 [`ContributionLedger.ts`](../src/game/live/ContributionLedger.ts)。礼物每抖币 10000 分，点赞每次 1 分，弹幕每条 20 分，非礼物基础贡献每人每局合计上限 10000。缺少稳定 ID、非法金额、溢出值或结算后的输入不增加贡献。

出兵由 `resolveWavePlan` 独立决定。当前演示中，点赞每个事件生成 1 到 5 个基础兵，普通弹幕生成两个基础兵；礼物还沿用 500、2000 两档金额阈值。它们是演示映射，尚未完成真实礼物价值与兵力的平衡设计。

阵营优先复用贡献记录中的阵营，否则由演示事件规则选择。首次可计分互动会建立贡献记录，之后本局保持阵营；进房等不计分事件不会建立该记录。正式的入场、未计分事件与换阵营规则仍需补齐。

## 待实现的抖音适配

以下是开发接线约定，当前仓库没有实现这条链路。参考采集器默认提供 `ws://127.0.0.1:8888`，外层包包含 `Type`、`ProcessName` 和字符串形式的 `Data`，需要分两层解析。

| 采集器数据 | 统一事件约定 |
| --- | --- |
| `Type=1`、`Content` | `kind=danmaku`、`message=Content` |
| `Type=2`、`Count` | `kind=like`、`likeCount=Count`；不使用累计 `Total` |
| `Type=5`、`GiftCount` | `kind=gift`、`giftNum=GiftCount`；不重复累计 `RepeatCount` |
| `DiamondCount` | `price`，`totalPrice=DiamondCount × GiftCount` |
| `User.SecUid` | 优先作为字符串 `openId`，缺失时制定无损的 `User.Id` 回退规则 |
| `User.Nickname` | `uname` |
| `MsgId` 和房间标识 | 用于构造稳定事件 ID、过滤目标房间及重连去重 |

`User.Id`、`MsgId`、`GroupId` 等字段在采集器中可能是 64 位整数。不能先用普通 JavaScript 数字解析丢失精度，再调用 `String()` 补救；需要在序列化边界或无损解析阶段保留原值。

真实适配器需要同时处理：目标房间过滤、身份缺失、礼物增量、稳定消息 ID、重连、重复消息、异常包、金额单位，以及结算和重开期间的事件策略。当前 `POST /mock` 会重新生成 ID 和时间戳，不应被直接当作真实事件的无损入口。详细验收条件见[开发路线](ROADMAP.md)。
