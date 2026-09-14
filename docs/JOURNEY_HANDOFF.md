# 单次旅行与占星台足迹交付

Wanderwise 只展示当前旅行的足迹。收藏和个人思考仍保留原来的持久化方式。

## 旅行边界

- `sessionStorage["wanderwise.trip-session.v1"]` 只存一个 `{ id, startedAt, journey }`。
- 同一标签页刷新或浏览器前进/后退时恢复该标签页的当前旅行。
- 新导航、新标签页（包括复制了 opener 的 sessionStorage）开始新旅行；初始化在一个文档内幂等，兼容 React StrictMode。
- 收到新的占星台 `wanderwise:enter` 指令、手动结束旅行后，由应用调用 `startNewTrip()` 开始新的空记录。
- 不读取、不删除旧 `localStorage["wanderwise.journey.v1"]`。旧版本的累计足迹不会混入新旅行。
- 关闭标签页不自动授权导出。只有用户在应用中明确选择导出，才创建交付包并通知占星台。
- 浏览器通常不允许网页自定义真正关闭标签页时的 `beforeunload` 提示文案，也不保证关闭时能执行异步操作。应用的“结束旅行”入口提供完整选择；原生离开提醒只能帮助用户返回页面完成选择，不能视为导出授权。

## 交付协议

每次显式导出生成一个 `JourneyExportPacket`，类型和规范化器见 `src/lib/trip.ts`：

```ts
{
  version: 1,
  tripId: "唯一旅行 ID",
  startedAt: "ISO 时间",
  endedAt: "ISO 时间",
  query: "当前探索主题",
  journey: [{
    id: "访问记录 ID",
    title: "实际访问的问题或回答",
    type: "question" | "answer",
    questionId: "来源问题 ID",
    answerId?: "来源回答 ID",
    query: "本次访问的检索词",
    visitedAt: "ISO 时间",
    url?: "内容已有的 HTTP(S) 来源链接"
  }]
}
```

记录保留每一次访问所属的检索词，不会在重新搜索时混成一个来源。只导出实际记录；不生成推测内容。包最多 1,000 条记录和 4,000,000 字符，读取时会验证结构、ID、时间和链接。

`exportJourneyToObservatory(packet)` 会：

1. 先写入同源持久待收箱 `localStorage["wanderwise.journey-export.v1." + tripId]`，每趟独立键，多个标签页不会互相覆盖。
2. 分发同文档 `wanderwise:journey-export` 事件，`event.detail` 就是上述完整数据包。
3. 若父窗口或 opener 是同源窗口，发送 `{ type: "wanderwise:journey-export", payload: packet }` 的 `postMessage` 通知，严格限定同源；不向第三方地址发送请求。
4. 返回 `{ stored, acknowledged }`。`stored` 只表示等待占星台领取，`acknowledged` 只在占星台通过消费接口确认领取时为真。收到事件或完成页面导航本身不等于占星台已接收。

页面现有的 `wanderwise:return` 事件、同源 `returnUrl` 导航和 `summary.journey` 保持兼容；可附加 `summary.trip` 完整数据包。

占星台真正保存后再消费待收箱。消费只删除这一趟的待收记录，不删除收藏、思考或其他标签页的导出包。导出不是当前旅行历史累积：应用可以在成功排队后清空本次足迹，但未领取包会独立保留，直到占星台确认。

## 可复制的同源占星台接收端

当前 main 工作树不包含占星台工程；已有宿主位于同仓库的 `20260914` 分支，集成实现使用 `src/features/personal/galaxyVoyages.ts` 接收、真实 IndexedDB 事务提交后确认，并在「漫行者日志」显示独立银河行程。下面的通用接收代码供其他宿主使用；将 `saveTrip` 接到该产品已有的旅行存储与展示逻辑，按 `tripId` 幂等写入。函数只在 `saveTrip` 完成之后确认消费。

```ts
import {
  listJourneyExports,
  consumeJourneyExport,
} from './wanderwise/src/lib/integration'; // 替换成集成后的实际模块路径
import { normalizeJourneyExport, type JourneyExportPacket } from './wanderwise/src/lib/trip';

export function connectWanderwise(
  saveTrip: (trip: JourneyExportPacket) => Promise<void>,
) {
  const receiving = new Set<string>();

  async function receive(value: unknown) {
    const trip = normalizeJourneyExport(value);
    if (!trip || receiving.has(trip.tripId)) return;
    receiving.add(trip.tripId);
    try {
      await saveTrip(trip); // 真正交给占星台存储；失败时保留待收包，以便重试
      consumeJourneyExport(trip.tripId);
    } catch (error) {
      console.error('漫游足迹尚未领取，可稍后重试', error);
    } finally {
      receiving.delete(trip.tripId);
    }
  }

  const onExport = (event: Event) => void receive((event as CustomEvent).detail);
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== location.origin || event.data?.type !== 'wanderwise:journey-export') return;
    void receive(event.data.payload);
  };
  const scan = () => listJourneyExports().forEach(trip => void receive(trip));
  window.addEventListener('wanderwise:journey-export', onExport);
  window.addEventListener('message', onMessage);
  window.addEventListener('storage', scan);
  window.addEventListener('focus', scan);
  scan(); // 即使漫游页已经关闭，持久待收包仍可读取

  return () => {
    window.removeEventListener('wanderwise:journey-export', onExport);
    window.removeEventListener('message', onMessage);
    window.removeEventListener('storage', scan);
    window.removeEventListener('focus', scan);
  };
}
```

如果占星台和 Wanderwise 在同一文档运行，注册入口后也可使用 `window.Wanderwise.listJourneyExports()` / `window.Wanderwise.consumeJourneyExport(tripId)`。卸载 Wanderwise 的桥接注册会还原原来的 `window.Wanderwise` 对象，不破坏宿主已有属性。

若浏览器存储不可用，接口只发送同文档 `wanderwise:journey-export-pending` 元数据事件（`{ version: 1, tripId }`），不广播完整足迹，也不发异步 `postMessage`。已运行的同文档宿主可以在该事件的同步回调中调用 `consumeJourneyExport(tripId)`，取得数据并确认接管。此时“已接收”表示宿主接管了数据，不表示 Wanderwise 已替宿主完成持久化；宿主需自行保存，不能在尚未准备接管时消费。同步回调结束仍无人领取时，内存待收包立即移除，返回 `{ stored: false, acknowledged: false }`，应用保留旅行供重试；用户随后选择“不导出”不会留下后来可被领取的包。延迟或异步消费此失败尝试不会获得数据。

正常持久化成功时，宿主可以异步保存后再消费；接口当次返回的仍是“已保存、待领取”，不会把已经发出的事件误判成接收确认。跨域占星台尚无接收约定，当前实现不会自动向跨域位置交付私人足迹。
