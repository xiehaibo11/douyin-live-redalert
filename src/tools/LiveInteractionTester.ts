import * as THREE from 'three';
import { Art } from '@/game/art/Art';
import { BoxedVar } from '@/util/BoxedVar';
import { Color } from '@/util/Color';
import { CompositeDisposable } from '@/util/disposable/CompositeDisposable';
import { CanvasMetrics } from '@/gui/CanvasMetrics';
import { Pointer } from '@/gui/Pointer';
import { UiScene } from '@/gui/UiScene';
import { JsxRenderer } from '@/gui/jsx/JsxRenderer';
import { GeneralOptions } from '@/gui/screen/options/GeneralOptions';
import { WorldView } from '@/gui/screen/game/WorldView';
import { Minimap } from '@/gui/screen/game/component/Minimap';
import { ReplayLoadingScreenApi } from '@/gui/screen/game/loadingScreen/ReplayLoadingScreenApi';
import { WorldInteractionFactory } from '@/gui/screen/game/worldInteraction/WorldInteractionFactory';
import { Engine } from '@/engine/Engine';
import { IsoCoords } from '@/engine/IsoCoords';
import { Renderer } from '@/engine/gfx/Renderer';
import { WorldScene } from '@/engine/renderable/WorldScene';
import { TheaterType } from '@/engine/TheaterType';
import { ResourceType } from '@/engine/resourceConfigs';
import { UiAnimationLoop } from '@/engine/UiAnimationLoop';
import { ConsoleVars } from '@/ConsoleVars';
import { GameMap } from '@/game/GameMap';
import { GameFactory } from '@/game/GameFactory';
import { Game } from '@/game/Game';
import { BuildStatus } from '@/game/gameobject/Building';
import { Coords } from '@/game/Coords';
import { Infantry } from '@/game/gameobject/Infantry';
import { AttackMoveOrder } from '@/game/order/AttackMoveOrder';
import { Player } from '@/game/Player';
import { Rules } from '@/game/rules/Rules';
import { SpeedType } from '@/game/type/SpeedType';
import { TileSets } from '@/game/theater/TileSets';
import { MapPanningHelper } from '@/engine/util/MapPanningHelper';
import { RenderableManager } from '@/engine/RenderableManager';
import { VxlGeometryPool } from '@/engine/renderable/builder/vxlGeometry/VxlGeometryPool';
import { VxlGeometryCache } from '@/engine/gfx/geometry/VxlGeometryCache';
import { ImageFinder } from '@/engine/ImageFinder';
import { MissingImageError } from '@/engine/ImageFinder';
import { ObjectType } from '@/engine/type/ObjectType';
import { LiveRound } from '@/game/live/LiveRound';
import { ContributionLedger, type Contributor } from '@/game/live/ContributionLedger';
import { armyFocus } from '@/game/live/BroadcastCamera';
import './live-interaction.css';
import type { TechnoRules } from '@/game/rules/TechnoRules';
import { BuildingAnimArtProps } from '@/engine/renderable/entity/building/BuildingAnimArtProps';
import { TestToolSupport, type TestToolRuntimeContext } from '@/tools/TestToolSupport';
import { RadialTileFinder } from '@/game/map/tileFinder/RadialTileFinder';
import { NO_TEAM_ID } from '@/game/gameopts/constants';

type StringsLike = {
    get(key: string): string | undefined;
};

type LiveInteractionRuntimeDeps = {
    generalOptions?: GeneralOptions;
    runtimeVars?: ConsoleVars;
};

type BattleSideId = 'left' | 'right';
type LiveMode = 'mock' | 'live';
type InteractionKind =
    | 'room-enter'
    | 'gift'
    | 'guard'
    | 'super-chat'
    | 'like'
    | 'danmaku'
    | 'live-start'
    | 'live-end'
    | 'unknown';

type NormalizedInteractionEvent = {
    id: string;
    kind: InteractionKind;
    cmd: string;
    timestamp: number;
    uname?: string;
    openId?: string;
    message?: string;
    giftName?: string;
    giftNum?: number;
    price?: number;
    totalPrice?: number;
    likeCount?: number;
    guardLevel?: number;
    raw?: Record<string, unknown>;
};

type RuntimeStatus = {
    mode: LiveMode;
    connected: boolean;
    connecting: boolean;
    sessionActive: boolean;
    eventCount: number;
    lastError?: string | null;
    lastEventAt?: number | null;
    anchor?: {
        roomId?: number;
        uname?: string;
        openId?: string;
    } | null;
};

type UnitCatalog = {
    infantryBasic: string;
    infantryElite: string;
    vehicleLight: string;
    vehicleHeavy: string;
};

type WavePlan = {
    side: BattleSideId;
    reason: string;
    infantryBasic?: number;
    infantryElite?: number;
    vehicleLight?: number;
    vehicleHeavy?: number;
    veteran?: boolean;
    viewerLabel?: string;
};

type SideStats = {
    totalSpawned: number;
    lastReinforcementAt?: number;
};

type BattleContext = {
    game: Game;
    gameMap: GameMap;
    worldView: WorldView;
    uiScene: UiScene;
    minimap: Minimap;
    pointer: Pointer;
    canvasMetrics: CanvasMetrics;
    worldInteraction: any;
    renderableManager: RenderableManager;
    worldScene: WorldScene;
    leftPlayer: Player;
    rightPlayer: Player;
    leftAnchor: any;
    rightAnchor: any;
    leftTarget: any;
    rightTarget: any;
    leftBase: any;
    rightBase: any;
    centerTile: any;
    localBounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    unitCatalog: UnitCatalog;
};

type UiRefs = {
    host?: HTMLDivElement;
    canvasPane?: HTMLDivElement;
    overlayPane?: HTMLDivElement;
    minimapShell?: HTMLDivElement;
    panel?: HTMLDivElement;
    panelContent?: HTMLDivElement;
    panelToggle?: HTMLButtonElement;
    log?: HTMLDivElement;
    statusSummary?: HTMLDivElement;
    leftSummary?: HTMLDivElement;
    rightSummary?: HTMLDivElement;
    catalogSummary?: HTMLDivElement;
    mappingSummary?: HTMLPreElement;
    statusBadge?: HTMLDivElement;
    modeSelect?: HTMLSelectElement;
    appIdInput?: HTMLInputElement;
    accessKeyIdInput?: HTMLInputElement;
    accessSecretInput?: HTMLInputElement;
    codeInput?: HTMLInputElement;
    credentialsGrid?: HTMLDivElement;
    danmakuInput?: HTMLInputElement;
    roundSummary?: HTMLDivElement;
    broadcastHud?: HTMLDivElement;
    contributionRows?: HTMLDivElement;
    settlement?: HTMLDivElement;
    settlementRows?: HTMLDivElement;
    settlementTitle?: HTMLElement;
    settlementMvp?: HTMLElement;
    settlementCountdown?: HTMLElement;
};

type LiveLoadingScreenSession = {
    api: ReplayLoadingScreenApi;
    uiScene: UiScene;
    rootEl: HTMLDivElement;
    dispose: () => void;
};

const TOOL_NAME = 'liveinteraction';
const DEFAULT_VIEWPORT_WIDTH = 1280;
const DEFAULT_VIEWPORT_HEIGHT = 720;
const PANEL_WIDTH = 360;
const PANEL_MIN_WIDTH = 300;
const PANEL_MARGIN = 16;
const PANEL_COLLAPSED_VISIBLE_WIDTH = 30;
const MIN_BATTLE_VIEWPORT_WIDTH = 720;
const MINIMAP_SIZE = 248;
const MINIMAP_MARGIN = 16;
const STATUS_POLL_MS = 3000;
const GAME_TICK_MS = 33;
const ORDER_REFRESH_MS = 1200;
const MAX_LOG_ENTRIES = 14;
const BASE_HP_DISPLAY_MAX = 100;
const MAX_UNIT_LABELS_PER_WAVE = 2;
const API_BASE = '/api/live-interaction';
const MIN_BATTLE_ZOOM = 0.75;
const MAX_BATTLE_ZOOM = 2.4;
const LOADING_SCREEN_MIN_DURATION_MS = 350;
export class LiveInteractionTester {
    private static disposables = new CompositeDisposable();
    private static renderer?: Renderer;
    private static uiAnimationLoop?: UiAnimationLoop;
    private static renderableManager?: RenderableManager;
    private static battle?: BattleContext;
    private static ui: UiRefs = {};
    private static eventSource?: EventSource;
    private static gameTickTimer?: number;
    private static statusPollTimer?: number;
    private static orderRefreshTimer?: number;
    private static panelCollapsed = false;
    private static round = new LiveRound();
    private static restartTimer?: number;
    private static restart?: () => Promise<void>;
    private static seenEvents = new Set<string>();
    private static contributions = new ContributionLedger();
    private static roundResults: Contributor[] = [];
    private static cameraManualUntil = 0;
    private static state = {
        ready: false,
        mode: 'mock' as LiveMode,
        runtimeStatus: {
            mode: 'mock',
            connected: false,
            connecting: false,
            sessionActive: false,
            eventCount: 0,
            lastError: null,
            lastEventAt: null,
            anchor: null,
        } as RuntimeStatus,
        left: {
            totalSpawned: 0,
            lastReinforcementAt: undefined,
        } as SideStats,
        right: {
            totalSpawned: 0,
            lastReinforcementAt: undefined,
        } as SideStats,
        lastEvent: null as NormalizedInteractionEvent | null,
        recentEvents: [] as Array<{
            at: number;
            text: string;
        }>,
    };

    static async main(_mixFileLoader: any, gameMapFile: any, parentElement: HTMLElement, strings: StringsLike, context: TestToolRuntimeContext = {}, deps: LiveInteractionRuntimeDeps = {}): Promise<void> {
        await this.destroy();
        this.contributions = new ContributionLedger();
        this.roundResults = [];
        this.cameraManualUntil = 0;
        this.restart = () => this.main(_mixFileLoader, gameMapFile, parentElement, strings, context, deps);
        const initialViewport = this.measureViewport();
        const root = TestToolSupport.prepareHost(context, initialViewport.width, initialViewport.height);
        const loadingStartedAt = performance.now();
        const loadingScreen = this.createLoadingScreen(root, strings);
        try {
            await loadingScreen.api.start(this.createLoadingScreenPlayers(), '直播互动');
            loadingScreen.uiScene.create3DObject();
            loadingScreen.uiScene.update(0);
            await this.flushUi();
            loadingScreen.api.onLoadProgress(12);

            await TestToolSupport.ensureTheater(gameMapFile.theaterType ?? TheaterType.Temperate, context.cdnResourceLoader, [
                ResourceType.UiAlly,
                ResourceType.BuildGen,
                ResourceType.Vxl,
                ResourceType.Anims,
            ]);
            loadingScreen.api.onLoadProgress(38);
            await this.flushUi();

            this.buildLayout(root, strings);
            loadingScreen.api.onLoadProgress(56);
            await this.flushUi();

            const battle = await this.initializeBattle(gameMapFile, strings, context, deps);
            this.battle = battle;
            this.round.start(Date.now());
            loadingScreen.api.onLoadProgress(86);

            this.installResponsiveViewport();
            this.syncBattleViewport(true);
            this.bindRuntimeBridge();
            this.startSimulationLoops();
            this.buildHomeButton();
            loadingScreen.api.onLoadProgress(100);

            const remainingLoadingTime = LOADING_SCREEN_MIN_DURATION_MS - (performance.now() - loadingStartedAt);
            await this.flushUi(Math.max(0, remainingLoadingTime));

            this.appendLog('系统', '直播互动模式已加载，可先用右侧 mock 按钮验证效果。');
            this.state.ready = true;
            this.syncState();
            const debugRoot = ((window as any).__ra2debug ??= {});
            debugRoot.liveInteraction = {
                snapshot: () => this.getDebugSnapshot(),
                emitMock: (kind: InteractionKind, payload: Record<string, unknown> = {}) => this.postJson(`${API_BASE}/mock`, { kind, ...payload }),
                advanceTicks: (count: number) => {
                    if (!Number.isInteger(count) || count < 1 || count > 600 || this.state.mode !== 'mock') throw new Error('Invalid mock tick count');
                    for (let index = 0; index < count && this.round.phase === 'running'; index++) {
                        this.updateBattle();
                        if (index % 36 === 0) this.refreshOrders();
                    }
                    this.syncState();
                },
            };
            if (context.rootElement) {
                context.rootElement.dataset.ra2LiveInteractionReady = '1';
            }
        } finally {
            loadingScreen.dispose();
        }
    }

    static async destroy(): Promise<void> {
        TestToolSupport.clearState(TOOL_NAME);
        this.round.phase = 'loading';
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = undefined;
        this.restart = undefined;
        this.seenEvents.clear();
        this.eventSource?.close();
        this.eventSource = undefined;
        if (this.gameTickTimer) {
            clearInterval(this.gameTickTimer);
            this.gameTickTimer = undefined;
        }
        if (this.statusPollTimer) {
            clearInterval(this.statusPollTimer);
            this.statusPollTimer = undefined;
        }
        if (this.orderRefreshTimer) {
            clearInterval(this.orderRefreshTimer);
            this.orderRefreshTimer = undefined;
        }
        this.disposables.dispose();
        this.renderer = undefined;
        this.uiAnimationLoop = undefined;
        this.renderableManager = undefined;
        this.battle = undefined;
        const host = this.ui.host;
        if (host) {
            host.replaceChildren();
            host.style.position = 'relative';
            host.style.inset = '';
            host.style.display = 'block';
            host.style.width = '';
            host.style.height = '';
            host.style.overflow = 'visible';
            host.style.background = '';
            host.style.zIndex = '';
            host.style.left = '';
            host.style.top = '';
            host.style.transform = '';
            host.style.top = '';
            host.style.right = '';
            host.style.bottom = '';
            host.style.cursor = '';
            host.style.touchAction = '';
            delete host.dataset.ra2LiveInteractionReady;
            delete host.dataset.liveBroadcastFrame;
        }
        this.ui = {};
        this.panelCollapsed = false;
        this.state.ready = false;
        this.state.lastEvent = null;
        this.state.recentEvents = [];
        this.state.left = { totalSpawned: 0 };
        this.state.right = { totalSpawned: 0 };
        const debugRoot = (window as any).__ra2debug;
        if (debugRoot?.liveInteraction) {
            delete debugRoot.liveInteraction;
        }
        if (debugRoot?.liveInteractionBattle) {
            delete debugRoot.liveInteractionBattle;
        }
    }

    private static buildLayout(root: HTMLElement, strings: StringsLike): void {
        root.dataset.liveBroadcastFrame = '1';
        root.replaceChildren();
        root.style.position = 'fixed';
        root.style.inset = '0';
        root.style.display = 'block';
        const viewport = this.measureViewport();
        root.style.width = `${viewport.width}px`;
        root.style.height = `${viewport.height}px`;
        root.style.top = `${Math.floor((window.innerHeight - viewport.height) / 2)}px`;
        root.style.left = '50%';
        root.style.transform = 'translateX(-50%)';
        root.style.overflow = 'hidden';
        root.style.background = 'radial-gradient(circle at 50% 45%, #3f0f0f 0%, #180404 45%, #090202 100%)';
        root.style.zIndex = '1';
        this.panelCollapsed = true;

        const canvasPane = document.createElement('div');
        canvasPane.style.position = 'absolute';
        canvasPane.style.inset = '0';
        canvasPane.style.width = '100%';
        canvasPane.style.height = '100%';
        canvasPane.style.background = '#0d0d0d';
        canvasPane.style.cursor = 'grab';
        canvasPane.style.touchAction = 'none';
        canvasPane.dataset.liveCanvas = '1';

        const overlayPane = document.createElement('div');
        overlayPane.style.position = 'absolute';
        overlayPane.style.inset = '0';
        overlayPane.style.pointerEvents = 'none';
        overlayPane.style.zIndex = '2';

        const minimapShell = document.createElement('div');
        minimapShell.style.position = 'absolute';
        minimapShell.style.left = `${MINIMAP_MARGIN}px`;
        minimapShell.style.bottom = `${MINIMAP_MARGIN}px`;
        minimapShell.style.width = `${MINIMAP_SIZE}px`;
        minimapShell.style.height = `${MINIMAP_SIZE}px`;
        minimapShell.style.boxSizing = 'border-box';
        minimapShell.style.border = '2px solid rgba(255, 216, 74, 0.72)';
        minimapShell.style.borderRadius = '6px';
        minimapShell.style.boxShadow = '0 0 0 1px rgba(0, 0, 0, 0.45), 0 8px 20px rgba(0, 0, 0, 0.28)';
        minimapShell.style.pointerEvents = 'none';
        minimapShell.style.zIndex = '1';
        minimapShell.dataset.liveMinimap = '1';

        const minimapBadge = document.createElement('div');
        minimapBadge.textContent = '全局地图';
        minimapBadge.style.position = 'absolute';
        minimapBadge.style.left = `${MINIMAP_MARGIN}px`;
        minimapBadge.style.bottom = `${MINIMAP_MARGIN + MINIMAP_SIZE + 8}px`;
        minimapBadge.style.padding = '4px 8px';
        minimapBadge.style.fontSize = '11px';
        minimapBadge.style.fontWeight = '700';
        minimapBadge.style.letterSpacing = '0.04em';
        minimapBadge.style.pointerEvents = 'none';
        minimapBadge.style.zIndex = '3';
        TestToolSupport.applyPanelTheme(minimapBadge);

        const panel = document.createElement('div');
        panel.className = 'live-interaction-panel';
        panel.style.position = 'absolute';
        panel.style.top = `${PANEL_MARGIN}px`;
        panel.style.right = `${PANEL_MARGIN}px`;
        panel.style.boxSizing = 'border-box';
        panel.style.height = `calc(100vh - ${PANEL_MARGIN * 2}px)`;
        panel.style.overflow = 'hidden';
        panel.style.zIndex = '3';
        panel.style.transition = 'transform 180ms ease, width 180ms ease';
        panel.style.willChange = 'transform, width';

        const panelToggle = this.buildButton('▶', 'toggle-panel');
        panelToggle.dataset.livePanelToggle = '1';
        panelToggle.style.position = 'absolute';
        panelToggle.style.left = '0';
        panelToggle.style.top = '0';
        panelToggle.style.bottom = '0';
        panelToggle.style.width = `${PANEL_COLLAPSED_VISIBLE_WIDTH}px`;
        panelToggle.style.padding = '10px 0';
        panelToggle.style.display = 'flex';
        panelToggle.style.alignItems = 'center';
        panelToggle.style.justifyContent = 'center';
        panelToggle.style.fontSize = '18px';
        panelToggle.style.fontWeight = '700';
        panelToggle.style.borderRadius = '0';
        panelToggle.style.zIndex = '1';

        const panelContent = document.createElement('div');
        panelContent.style.height = '100%';
        panelContent.style.padding = `14px 14px 14px ${PANEL_COLLAPSED_VISIBLE_WIDTH + 14}px`;
        panelContent.style.boxSizing = 'border-box';
        panelContent.style.display = 'flex';
        panelContent.style.flexDirection = 'column';
        panelContent.style.gap = '10px';
        panelContent.style.overflow = 'auto';
        panelContent.style.transition = 'opacity 120ms ease';

        const title = document.createElement('div');
        title.textContent = strings.get('GUI:MainMenu') ? '直播互动模式' : 'Live Interaction';
        title.style.fontSize = '24px';
        title.style.fontWeight = '700';
        const roundSummary = document.createElement('div');
        roundSummary.dataset.liveRound = '1';
        roundSummary.setAttribute('role', 'status');
        roundSummary.style.cssText = 'padding:12px;border:1px solid #ffd84a;font-weight:bold;white-space:pre-line';

        const subtitle = document.createElement('div');
        subtitle.textContent = '红方基地在左侧，蓝方基地在右侧。使用模拟事件召唤增援，摧毁敌方基地获胜。可右键拖动、滚轮缩放，或点击小地图查看战场。';
        subtitle.style.fontSize = '12px';
        subtitle.style.opacity = '0.85';
        subtitle.style.lineHeight = '1.5';

        const statusBadge = document.createElement('div');
        statusBadge.style.padding = '8px 10px';
        statusBadge.style.fontSize = '12px';
        statusBadge.style.border = '1px solid rgba(255, 200, 120, 0.4)';
        statusBadge.style.background = 'rgba(0, 0, 0, 0.2)';
        statusBadge.dataset.liveStatus = '1';

        const modeRow = document.createElement('div');
        modeRow.style.display = 'grid';
        modeRow.style.gridTemplateColumns = '72px 1fr';
        modeRow.style.alignItems = 'center';
        modeRow.style.gap = '8px';
        const modeLabel = document.createElement('label');
        modeLabel.textContent = '模式';
        const modeSelect = document.createElement('select');
        modeSelect.dataset.liveInput = 'mode';
        modeSelect.innerHTML = `
            <option value="mock">本地模拟</option>
            <option value="live" disabled>真实采集接入待开发</option>
        `;
        modeSelect.value = 'mock';

        const credentialsGrid = document.createElement('div');
        credentialsGrid.style.display = 'none';
        credentialsGrid.style.gridTemplateColumns = '72px 1fr';
        credentialsGrid.style.gap = '8px';
        credentialsGrid.style.alignItems = 'center';

        const appIdInput = this.buildLabeledInput(credentialsGrid, 'App ID', 'appId');
        const accessKeyIdInput = this.buildLabeledInput(credentialsGrid, 'Access Key', 'accessKeyId');
        const accessSecretInput = this.buildLabeledInput(credentialsGrid, 'Access Secret', 'accessSecret', 'password');
        const codeInput = this.buildLabeledInput(credentialsGrid, '身份码', 'code');

        const actionsRow = document.createElement('div');
        actionsRow.style.display = 'grid';
        actionsRow.style.gridTemplateColumns = '1fr 1fr';
        actionsRow.style.gap = '8px';
        const connectButton = this.buildButton('连接', 'connect');
        const disconnectButton = this.buildButton('断开', 'disconnect');
        actionsRow.append(connectButton, disconnectButton);

        const mockTitle = document.createElement('div');
        mockTitle.textContent = '本地测试';
        mockTitle.style.fontSize = '14px';
        mockTitle.style.fontWeight = '700';

        const mockButtons = document.createElement('div');
        mockButtons.style.display = 'grid';
        mockButtons.style.gridTemplateColumns = '1fr 1fr';
        mockButtons.style.gap = '8px';
        mockButtons.append(
            this.buildButton('模拟进房', 'mock-room-enter'),
            this.buildButton('模拟点赞', 'mock-like'),
            this.buildButton('模拟礼物', 'mock-gift'),
            this.buildButton('红方弹幕(左)', 'mock-danmaku-left'),
            this.buildButton('蓝方弹幕(右)', 'mock-danmaku-right'),
            this.buildButton('战场全览', 'focus-center'),
        );

        const danmakuRow = document.createElement('div');
        danmakuRow.style.display = 'grid';
        danmakuRow.style.gridTemplateColumns = '1fr auto';
        danmakuRow.style.gap = '8px';
        const danmakuInput = document.createElement('input');
        danmakuInput.placeholder = '自定义弹幕，例如：蓝军 下路冲 / 红军 上路守';
        danmakuInput.dataset.liveInput = 'danmaku';
        const danmakuSubmit = this.buildButton('发送', 'mock-danmaku-custom');
        danmakuRow.append(danmakuInput, danmakuSubmit);

        const statusSummary = document.createElement('div');
        const leftSummary = document.createElement('div');
        const rightSummary = document.createElement('div');
        const catalogSummary = document.createElement('div');
        [statusSummary, leftSummary, rightSummary, catalogSummary].forEach((block) => {
            block.style.fontSize = '12px';
            block.style.lineHeight = '1.6';
            block.style.whiteSpace = 'pre-wrap';
            block.style.border = '1px solid rgba(255, 200, 120, 0.25)';
            block.style.background = 'rgba(0, 0, 0, 0.2)';
            block.style.padding = '8px';
        });

        const mappingSummary = document.createElement('pre');
        mappingSummary.style.margin = '0';
        mappingSummary.style.fontSize = '11px';
        mappingSummary.style.lineHeight = '1.5';
        mappingSummary.style.whiteSpace = 'pre-wrap';
        mappingSummary.textContent = [
            '事件映射',
            '进房 / 点赞 -> 红方左侧增援',
            '礼物 -> 观众所属阵营增援',
            '弹幕含“红/上/top” -> 红方左侧',
            '弹幕含“蓝/下/bottom” -> 蓝方右侧',
            '重装与精英单位会优先显示观众昵称',
        ].join('\n');

        const logTitle = document.createElement('div');
        logTitle.textContent = '事件日志';
        logTitle.style.fontSize = '14px';
        logTitle.style.fontWeight = '700';

        const log = document.createElement('div');
        log.style.display = 'flex';
        log.style.flexDirection = 'column';
        log.style.gap = '6px';
        log.style.fontSize = '12px';
        log.style.lineHeight = '1.4';
        log.style.minHeight = '120px';

        modeRow.append(modeLabel, modeSelect);
        panelContent.append(
            title,
            roundSummary,
            subtitle,
            statusBadge,
            modeRow,
            credentialsGrid,
            actionsRow,
            mockTitle,
            mockButtons,
            danmakuRow,
            statusSummary,
            leftSummary,
            rightSummary,
            catalogSummary,
            mappingSummary,
            logTitle,
            log,
        );
        panel.append(panelToggle, panelContent);
        root.append(canvasPane, overlayPane, minimapShell, minimapBadge, panel);
        minimapShell.appendChild(minimapBadge);
        minimapBadge.style.cssText = 'position:absolute;left:50%;top:-21px;bottom:auto;transform:translateX(-50%);white-space:nowrap;font-size:10px;padding:2px 7px;background:#101a28df;color:#dfd4ae;border:1px solid #667180';
        TestToolSupport.applyPanelTheme(panel);
        this.ui = {
            roundSummary,
            host: root as HTMLDivElement,
            canvasPane,
            overlayPane,
            minimapShell,
            panel,
            panelContent,
            panelToggle,
            log,
            statusSummary,
            leftSummary,
            rightSummary,
            catalogSummary,
            mappingSummary,
            statusBadge,
            modeSelect,
            appIdInput,
            accessKeyIdInput,
            accessSecretInput,
            codeInput,
            credentialsGrid,
            danmakuInput,
        };
        this.buildBroadcastHud(root);
        canvasPane.addEventListener('pointerdown', () => { this.cameraManualUntil = Date.now() + 4000; });
        canvasPane.addEventListener('pointermove', event => { if (event.buttons) this.cameraManualUntil = Date.now() + 4000; });
        canvasPane.addEventListener('wheel', () => { this.cameraManualUntil = Date.now() + 4000; }, { passive: true });
        this.updatePanelLayout(this.measureViewport());
        modeSelect.addEventListener('change', () => {
            this.state.mode = modeSelect.value === 'live' ? 'live' : 'mock';
            credentialsGrid.style.display = this.state.mode === 'live' ? 'grid' : 'none';
            this.syncState();
        });
        connectButton.addEventListener('click', () => void this.handleConnect());
        disconnectButton.addEventListener('click', () => void this.handleDisconnect());
        panel.addEventListener('click', (event) => {
            const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-live-action]');
            if (!button) {
                return;
            }
            const action = button.dataset.liveAction;
            if (!action) {
                return;
            }
            void this.handleUiAction(action);
        });
    }

    private static createLoadingScreen(root: HTMLElement, strings: StringsLike): LiveLoadingScreenSession {
        const viewport = {
            x: 0,
            y: 0,
            width: root.clientWidth || DEFAULT_VIEWPORT_WIDTH,
            height: root.clientHeight || DEFAULT_VIEWPORT_HEIGHT,
        };
        const uiScene = UiScene.factory(viewport);
        const htmlRoot = document.createElement('div');
        htmlRoot.dataset.liveLoadingScreen = '1';
        htmlRoot.style.position = 'absolute';
        htmlRoot.style.inset = '0';
        htmlRoot.style.zIndex = '1200';
        htmlRoot.style.pointerEvents = 'none';
        htmlRoot.style.background = '#000';
        uiScene.getHtmlContainer()?.setElement(htmlRoot);
        uiScene.getHtmlContainer()?.setSize('100%', '100%');

        const jsxRenderer = new JsxRenderer(Engine.images, Engine.palettes, uiScene.getCamera());
        const loadingBaseUrl = new URL('/cdn/game-res/v2/', window.location.href).toString();
        const loadingRules = new Rules(Engine.getRules());
        const gameResConfig = {
            isCdn: () => true,
            getCdnBaseUrl: () => loadingBaseUrl,
        };
        const api = new ReplayLoadingScreenApi(
            loadingRules as any,
            strings as any,
            uiScene as any,
            jsxRenderer as any,
            gameResConfig as any,
        );

        root.appendChild(htmlRoot);

        return {
            api,
            uiScene,
            rootEl: htmlRoot,
            dispose: () => {
                api.dispose();
                uiScene.destroy();
                htmlRoot.remove();
            },
        };
    }

    private static createLoadingScreenPlayers(): Array<{
        name: string;
        countryId: number;
        colorId: number;
        teamId: number;
    }> {
        const rules = new Rules(Engine.getRules());
        const countryNames = rules.getMultiplayerCountries().map((country) => country.name);
        const topCountryId = this.findNamedIndex(countryNames, ['Americans', 'America', 'British']);
        const bottomCountryId = this.findNamedIndex(countryNames, ['Russians', 'Russia', 'Confederation']);
        return [
            {
                name: '红方左侧老家',
                countryId: topCountryId,
                colorId: 0,
                teamId: NO_TEAM_ID,
            },
            {
                name: '蓝方右侧老家',
                countryId: bottomCountryId,
                colorId: 1,
                teamId: NO_TEAM_ID,
            },
        ];
    }

    private static async flushUi(extraDelayMs: number = 0): Promise<void> {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (extraDelayMs > 0) {
            await new Promise<void>((resolve) => window.setTimeout(() => resolve(), extraDelayMs));
        }
    }

    private static buildLabeledInput(parent: HTMLElement, label: string, key: string, type: string = 'text'): HTMLInputElement {
        const labelEl = document.createElement('label');
        labelEl.textContent = label;
        const input = document.createElement('input');
        input.type = type;
        input.dataset.liveInput = key;
        input.autocomplete = 'off';
        parent.append(labelEl, input);
        return input;
    }

    private static buildButton(label: string, action: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.textContent = label;
        button.dataset.liveAction = action;
        return button;
    }

    private static buildBroadcastHud(root: HTMLElement): void {
        const hud = document.createElement('div');
        hud.className = 'live-broadcast-hud';
        hud.dataset.liveBroadcast = '1';
        hud.innerHTML = '<div class="live-hud-heading"><b data-live-round-label>直播对战</b><span>自动镜头</span></div><div class="live-armies"><div class="live-army-red" data-live-army-red></div><div class="live-army-blue" data-live-army-blue></div></div><div class="live-pressure"><div class="live-pressure-fill" data-live-pressure></div></div>';
        const settings = this.buildButton('设置', 'toggle-panel');
        settings.dataset.liveSettings = '1';
        settings.onclick = () => void this.handleUiAction('toggle-panel');
        hud.querySelector('.live-hud-heading')!.appendChild(settings);
        const contribution = document.createElement('div');
        contribution.className = 'live-contribution';
        contribution.innerHTML = '<div class="live-contribution-heading"><strong>本局贡献榜</strong><span>礼物贡献另计 · 基础上限1万</span></div>';
        const contributionRows = document.createElement('div');
        contributionRows.dataset.liveRanking = '1';
        contribution.appendChild(contributionRows);
        const settlement = document.createElement('div');
        settlement.className = 'live-settlement';
        settlement.dataset.liveSettlement = '1';
        settlement.hidden = true;
        settlement.tabIndex = 0;
        settlement.setAttribute('role', 'dialog');
        settlement.setAttribute('aria-modal', 'true');
        settlement.setAttribute('aria-label', '本局结算');
        settlement.innerHTML = '<div class="live-settlement-card"><div class="live-result-kicker">本局战报</div><h2 class="live-result-title"></h2><div class="live-result-mvp"></div><div class="live-result-columns"><span>观众贡献排行</span><span>总贡献分</span></div><div class="live-result-rows"></div><div class="live-result-countdown"><strong data-live-countdown>10</strong>秒后自动开始下一局</div><div class="live-result-policy">礼物每抖币计1万分 · 点赞每次1分 · 弹幕每条20分<br>每人每局基础贡献最多1万分</div></div>';
        settlement.addEventListener('keydown', event => { if (event.key === 'Tab') event.preventDefault(); });
        root.append(hud, contribution, settlement);
        Object.assign(this.ui, {
            broadcastHud: hud,
            contributionRows,
            settlement,
            settlementRows: settlement.querySelector('.live-result-rows'),
            settlementTitle: settlement.querySelector('.live-result-title'),
            settlementMvp: settlement.querySelector('.live-result-mvp'),
            settlementCountdown: settlement.querySelector('[data-live-countdown]'),
        });
    }

    private static renderContributionRows(container: HTMLElement | undefined, players: Contributor[], limit: number): void {
        if (!container) return;
        container.replaceChildren();
        if (!players.length) {
            const empty = document.createElement('div');
            empty.className = 'live-rank-empty';
            empty.textContent = '等待观众参与';
            container.appendChild(empty);
        }
        players.slice(0, limit).forEach((player, index) => {
            const row = document.createElement('div');
            row.className = 'live-rank-row';
            row.dataset.viewerId = player.id;
            row.title = `礼物贡献 ${player.giftScore.toLocaleString('zh-CN')} · 基础贡献 ${player.baseScore.toLocaleString('zh-CN')}`;
            const rank = document.createElement('span');
            rank.textContent = String(index + 1);
            const name = document.createElement('div');
            name.className = 'live-rank-name';
            name.style.color = player.side === 'left' ? '#ffb0a0' : '#9bd8ff';
            name.textContent = player.name;
            if (container === this.ui.settlementRows) {
                const meta = document.createElement('div');
                meta.className = 'live-rank-meta';
                meta.textContent = `礼物 ${player.giftScore.toLocaleString('zh-CN')} · 基础 ${player.baseScore.toLocaleString('zh-CN')}`;
                name.appendChild(meta);
            }
            const score = document.createElement('strong');
            score.className = 'live-rank-value';
            score.textContent = player.score.toLocaleString('zh-CN');
            row.append(rank, name, score);
            container.appendChild(row);
        });
    }

    private static updateBroadcastHud(): void {
        const battle = this.battle;
        const hud = this.ui.broadcastHud;
        if (!battle || !hud) return;
        const left = this.countAliveUnits(battle.leftPlayer), right = this.countAliveUnits(battle.rightPlayer);
        hud.querySelector('[data-live-round-label]')!.textContent = `第 ${this.round.id} 局 · ${this.round.phase === 'settling' ? '已结束' : '直播对战'}`;
        hud.querySelector('[data-live-army-red]')!.textContent = `红方 ${left} 兵 · 基地 ${this.getBaseStatus(battle.leftBase, '').hpDisplay}`;
        hud.querySelector('[data-live-army-blue]')!.textContent = `蓝方 ${right} 兵 · 基地 ${this.getBaseStatus(battle.rightBase, '').hpDisplay}`;
        (hud.querySelector('[data-live-pressure]') as HTMLElement).style.width = `${left + right ? left / (left + right) * 100 : 50}%`;
        this.renderContributionRows(this.ui.contributionRows, this.contributions.ranking(), 5);
    }

    private static showSettlement(): void {
        const overlay = this.ui.settlement;
        if (!overlay) return;
        this.ui.settlementTitle!.textContent = this.round.winner === 'draw' ? '双方平局' : this.round.winner === 'left' ? '红方获胜' : '蓝方获胜';
        const mvp = this.round.winner === 'draw' ? this.roundResults[0] : this.roundResults.find(player => player.side === this.round.winner);
        this.ui.settlementMvp!.textContent = mvp ? `贡献 MVP · ${mvp.name}\n礼物贡献 ${mvp.giftScore.toLocaleString('zh-CN')} · 总贡献 ${mvp.score.toLocaleString('zh-CN')}` : '本局暂无胜方观众贡献记录';
        this.renderContributionRows(this.ui.settlementRows, this.roundResults, 10);
        overlay.hidden = false;
        for (const child of this.ui.host!.children) if (child instanceof HTMLElement && child !== overlay) child.inert = true;
        overlay.focus({ preventScroll: true });
    }

    private static buildHomeButton(): void {
        const button = document.createElement('button');
        button.textContent = '返回主页';
        button.style.cssText = 'padding:8px 12px;margin-top:12px';
        TestToolSupport.applyHomeButtonTheme(button);
        button.onclick = () => {
            window.location.hash = '/';
        };
        this.ui.panelContent?.appendChild(button);
        this.disposables.add(() => button.remove());
    }

    private static async initializeBattle(gameMapFile: any, strings: StringsLike, context: TestToolRuntimeContext, deps: LiveInteractionRuntimeDeps): Promise<BattleContext> {
        const canvasPane = this.ui.canvasPane;
        const host = this.ui.host;
        if (!canvasPane || !host) {
            throw new Error('Missing live interaction host panes');
        }

        const viewport = this.measureViewport();
        this.updatePanelLayout(viewport);
        const battleViewport = this.computeBattleViewport(viewport);
        const renderer = (this.renderer = new Renderer(viewport.width, viewport.height));
        renderer.init(canvasPane);
        const rendererCanvas = TestToolSupport.placeRendererCanvas(renderer, 0, 0);
        rendererCanvas.dataset.liveCameraCanvas = '1';
        this.disposables.add(renderer);

        const canvasMetrics = new CanvasMetrics(rendererCanvas, window);
        canvasMetrics.init();
        this.disposables.add(canvasMetrics);

        const generalOptions = new GeneralOptions();
        if (deps.generalOptions) {
            generalOptions.unserialize(deps.generalOptions.serialize());
        }
        generalOptions.rightClickMove.value = false;
        generalOptions.rightClickScroll.value = true;
        const runtimeVars = new ConsoleVars();
        runtimeVars.debugWireframes.value = deps.runtimeVars?.debugWireframes.value ?? false;
        runtimeVars.debugPaths.value = deps.runtimeVars?.debugPaths.value ?? false;
        runtimeVars.debugText.value = deps.runtimeVars?.debugText.value ?? false;
        runtimeVars.freeCamera.value = false;

        const pointer = Pointer.factory(
            Engine.getImages().get('mouse.shp'),
            Engine.getPalettes().get('mousepal.pal'),
            renderer,
            document,
            canvasMetrics,
            generalOptions.mouseAcceleration,
        );
        pointer.init();
        pointer.unlock();
        this.disposables.add(pointer);

        const uiScene = UiScene.factory(viewport);
        uiScene.add(pointer.getSprite());
        this.disposables.add(uiScene);

        const theaterType = gameMapFile.theaterType ?? TheaterType.Temperate;
        const theater = await Engine.loadTheater(theaterType);
        const activeEngine = Engine.getActiveEngine();
        const theaterSettings = Engine.getTheaterSettings(activeEngine, theaterType);
        const theaterIni = Engine.getTheaterIni(activeEngine, theaterType);
        const tileSets = new TileSets(theaterIni);
        tileSets.loadTileData(Engine.getTileData(), theaterSettings.extension);

        const gameModes = Engine.getMpModes();
        const gameModeId = gameModes.hasId(0) ? 0 : gameModes.getAll()[0]?.id ?? 0;
        const baseRules = new Rules(Engine.getRules());
        const multiplayerCountries = baseRules.getMultiplayerCountries().map((country) => country.name);
        const multiplayerColors = [...baseRules.getMultiplayerColors().keys()];
        const redCountryId = this.findNamedIndex(multiplayerCountries, ['Americans', 'America', 'British']);
        const blueCountryId = this.findNamedIndex(multiplayerCountries, ['Russians', 'Russia', 'Confederation']);
        const redColorId = this.findNamedIndex(multiplayerColors, ['DarkRed', 'Red', 'Orange']);
        const blueColorId = this.findNamedIndex(multiplayerColors, ['DarkBlue', 'Blue', 'SkyBlue']);
        const speedCheat = new BoxedVar(false);
        const debugBotIndex = new BoxedVar(0);
        const timestamp = Date.now();
        const gameOpts: any = {
            gameMode: gameModeId,
            gameSpeed: 5,
            credits: 10000,
            unitCount: 0,
            shortGame: false,
            superWeapons: false,
            buildOffAlly: false,
            mcvRepacks: false,
            cratesAppear: false,
            destroyableBridges: true,
            multiEngineer: false,
            noDogEngiKills: false,
            mapName: gameMapFile.name ?? '2_reconcile.map',
            mapTitle: gameMapFile.getOrCreateSection?.('Basic')?.getString?.('Name') ?? 'Live Interaction',
            mapDigest: '',
            mapSizeBytes: 0,
            maxSlots: 2,
            mapOfficial: true,
            humanPlayers: [
                { name: '红方', countryId: redCountryId, colorId: redColorId, startPos: 0, teamId: 0 },
                { name: '蓝方', countryId: blueCountryId, colorId: blueColorId, startPos: 1, teamId: 1 },
            ],
            aiPlayers: [],
        };
        const modRules = Engine.getIni(gameModes.getById(gameModeId).rulesOverride);
        const game = GameFactory.create(
            gameMapFile as any,
            tileSets,
            Engine.getRules(),
            Engine.getArt(),
            Engine.getAi(),
            modRules,
            [],
            'LiveInteraction',
            timestamp,
            gameOpts,
            gameModes,
            true,
            {},
            undefined,
            speedCheat,
            debugBotIndex,
        );
        const leftPlayer = game.getPlayerByName('红方');
        const rightPlayer = game.getPlayerByName('蓝方');
        IsoCoords.init({
            x: 0,
            y: (game.map.mapBounds.getFullSize().width * Coords.getWorldTileSize()) / 2,
        });
        game.init(undefined);
        this.removeBaseUnit(game, leftPlayer);
        this.removeBaseUnit(game, rightPlayer);
        game.start();

        const rules = game.rules as Rules;
        const art = game.art as Art;
        const gameMap = game.map as GameMap;
        const debugText = game.debugText as BoxedVar<string>;

        const minimap = new Minimap(game, undefined, 0xffd84a, game.rules.general.radar);
        minimap.setPointerEvents(pointer.pointerEvents);
        this.disposables.add(minimap);
        uiScene.add(minimap);
        this.updateMinimapLayout(viewport, minimap, battleViewport);

        const silentSound = {
            getSoundSpec: (key: unknown) => ({
                name: String(key),
                volume: 0,
                minVolume: 0,
                type: [],
                control: new Set(),
                limit: 0,
                range: 0,
            }),
            playWithOptions: () => undefined,
        };
        const worldView = new WorldView(
            { width: 0, height: 0 },
            game,
            silentSound as any,
            renderer,
            runtimeVars,
            minimap,
            strings,
            generalOptions,
            new VxlGeometryPool(new VxlGeometryCache(null, null)),
            new Map(),
        );
        const worldViewInitResult = worldView.init(undefined, battleViewport, theater);
        const worldScene = worldViewInitResult.worldScene;
        (worldScene as any).set3DObject?.((worldScene as any).scene);
        worldScene.create3DObject?.();
        (worldScene.scene as any).background = new THREE.Color(0x0f1416);
        const renderableManager = (this.renderableManager = worldViewInitResult.renderableManager);
        this.disposables.add(
            worldView,
            () => (this.renderableManager = undefined),
        );

        const keyBinds = {
            getCommandType() {
                return undefined;
            },
        };
        const worldInteraction = new WorldInteractionFactory(
            undefined,
            game,
            game.unitSelection,
            renderableManager,
            uiScene,
            worldScene,
            pointer,
            renderer,
            keyBinds,
            generalOptions,
            runtimeVars.freeCamera,
            runtimeVars.debugPaths,
            true,
            document,
            minimap,
            strings,
            '#ffd84a',
            debugText,
            undefined,
        ).create();
        worldInteraction.init?.();
        this.disposables.add(worldInteraction);

        renderer.addScene(worldScene);
        renderer.addScene(uiScene);
        host.appendChild(uiScene.getHtmlContainer().getElement());
        this.disposables.add(() => uiScene.getHtmlContainer().getElement().remove());

        const uiLoop = (this.uiAnimationLoop = new UiAnimationLoop(renderer));
        uiLoop.start();
        this.disposables.add(() => uiLoop.destroy());

        const localBounds = (gameMap as any).mapBounds.getLocalSize();
        const originalUpdateCamera = worldScene.updateCamera.bind(worldScene);
        worldScene.updateCamera = (pan: { x: number; y: number; }, zoom: number) => {
            worldScene.camera.zoom = zoom;
            originalUpdateCamera({
                x: pan.x * zoom,
                y: pan.y * zoom,
            }, zoom);
        };
        this.disposables.add(() => (worldScene.updateCamera = originalUpdateCamera));
        const originalZoomApplyStep = worldScene.cameraZoom.applyStep.bind(worldScene.cameraZoom);
        worldScene.cameraZoom.applyStep = (step: number) => {
            const minBattleZoom = this.computeMinBattleZoom(worldScene.viewport, gameMap, localBounds);
            const nextZoom = Math.max(minBattleZoom, Math.min(MAX_BATTLE_ZOOM, worldScene.cameraZoom.getZoom() + step));
            (worldScene.cameraZoom as any).zoom = nextZoom;
            this.updateBattlePanLimits(worldScene, gameMap, localBounds);
        };
        this.disposables.add(() => (worldScene.cameraZoom.applyStep = originalZoomApplyStep));
        this.updateBattlePanLimits(worldScene, gameMap, localBounds);
        const centerRx = localBounds.x + Math.floor(localBounds.width / 2);
        const centerRy = localBounds.y + Math.floor(localBounds.height / 2);
        const centerTile = gameMap.tiles.getByMapCoords(centerRx, centerRy) ?? gameMap.tiles.getByMapCoords(centerRx, centerRy - 1);
        if (!centerTile) {
            throw new Error('Failed to find map center tile for live interaction battle');
        }

        const unitCatalog = this.buildUnitCatalog(rules, art);
        const leftBaseName = this.pickHomeBaseName(rules, art, theater, ['GAPOWR', 'GACNST', 'GAREFN']);
        const rightBaseName = this.pickHomeBaseName(rules, art, theater, ['NAPOWR', 'NACNST', 'NAREFN']);
        const leftStart = gameMap.startingLocations[leftPlayer.startLocation];
        const rightStart = gameMap.startingLocations[rightPlayer.startLocation];
        if (!leftStart || !rightStart) {
            throw new Error('Live interaction map is missing the expected top/bottom start locations');
        }
        const leftBaseTile = this.findBasePlacementTile(
            gameMap,
            rules,
            art,
            leftBaseName,
            leftStart.x,
            leftStart.y,
        );
        const rightBaseTile = this.findBasePlacementTile(
            gameMap,
            rules,
            art,
            rightBaseName,
            rightStart.x,
            rightStart.y,
        );
        if (!leftBaseTile || !rightBaseTile) {
            throw new Error('Failed to place top/bottom home bases for live interaction battle');
        }

        const leftBase = this.spawnHomeBase(game, leftPlayer, leftBaseName, leftBaseTile, '红方老家');
        const rightBase = this.spawnHomeBase(game, rightPlayer, rightBaseName, rightBaseTile, '蓝方老家');
        const leftFoundation = leftBase.getFoundation();
        const rightFoundation = rightBase.getFoundation();
        const leftBaseCenterRx = leftBase.tile.rx + Math.floor(leftFoundation.width / 2);
        const rightBaseCenterRx = rightBase.tile.rx + Math.floor(rightFoundation.width / 2);
        const leftCenterRy = leftBase.tile.ry + Math.floor(leftFoundation.height / 2);
        const rightCenterRy = rightBase.tile.ry + Math.floor(rightFoundation.height / 2);
        const directionRx = Math.sign(rightBaseCenterRx - leftBaseCenterRx);
        const directionRy = Math.sign(rightCenterRy - leftCenterRy);
        const leftAnchor = this.findNearestPassableTile(gameMap, leftBaseCenterRx + directionRx * 2, leftCenterRy + directionRy * 2);
        const rightAnchor = this.findNearestPassableTile(gameMap, rightBaseCenterRx - directionRx * 2, rightCenterRy - directionRy * 2);
        const leftTarget = this.findNearestPassableTile(gameMap, rightBaseCenterRx - directionRx * 2, rightCenterRy - directionRy * 2);
        const rightTarget = this.findNearestPassableTile(gameMap, leftBaseCenterRx + directionRx * 2, leftCenterRy + directionRy * 2);
        const battleCenterTile = gameMap.tiles.getByMapCoords(
            Math.floor(((leftBase.centerTile?.rx ?? leftBaseCenterRx) + (rightBase.centerTile?.rx ?? rightBaseCenterRx)) / 2),
            Math.floor(((leftBase.centerTile?.ry ?? leftBase.tile.ry) + (rightBase.centerTile?.ry ?? rightBase.tile.ry)) / 2),
        ) ?? centerTile;
        if (!leftAnchor || !rightAnchor || !leftTarget || !rightTarget) {
            throw new Error('Failed to establish top/bottom spawn lanes for live interaction battle');
        }

        this.ui.catalogSummary!.textContent = [
            '单位映射',
            `红方左侧老家: ${leftBaseName}`,
            `蓝方右侧老家: ${rightBaseName}`,
            `红方基础步兵: ${unitCatalog.infantryBasic}`,
            `红方精英步兵: ${unitCatalog.infantryElite}`,
            `蓝方轻装甲: ${unitCatalog.vehicleLight}`,
            `蓝方重装甲: ${unitCatalog.vehicleHeavy}`,
        ].join('\n');
        this.disposables.add(() => game.dispose());

        const debugRoot = ((window as any).__ra2debug ??= {});
        debugRoot.liveInteractionBattle = {
            game,
            gameMap,
            uiScene,
            minimap,
            worldView,
            worldScene,
            worldInteraction,
            renderableManager,
            leftPlayer,
            rightPlayer,
            unitCatalog,
            leftAnchor,
            rightAnchor,
            leftTarget,
            rightTarget,
            leftBase,
            rightBase,
            centerTile: battleCenterTile,
        };

        return {
            game,
            gameMap,
            worldView,
            uiScene,
            minimap,
            pointer,
            canvasMetrics,
            worldInteraction,
            renderableManager,
            worldScene,
            leftPlayer,
            rightPlayer,
            leftAnchor,
            rightAnchor,
            leftTarget,
            rightTarget,
            leftBase,
            rightBase,
            centerTile: battleCenterTile,
            localBounds,
            unitCatalog,
        };
    }

    private static buildUnitCatalog(rules: Rules, art: Art): UnitCatalog {
        const availableByType = (type: ObjectType, names: Iterable<string>) => [...names].filter((name) => art.hasObject(name, type));
        const infantry = availableByType(ObjectType.Infantry, rules.infantryRules.keys());
        const vehicles = availableByType(ObjectType.Vehicle, rules.vehicleRules.keys());
        const pick = (candidates: string[], available: string[], fallbackLabel: string) => {
            const match = candidates.find((candidate) => available.includes(candidate));
            if (match) {
                return match;
            }
            if (!available.length) {
                throw new Error(`No available ${fallbackLabel} units found for live interaction mode`);
            }
            return available[0];
        };
        return {
            infantryBasic: pick(['E1', 'E2', 'DOG', 'SHK', 'GGI'], infantry, 'infantry'),
            infantryElite: pick(['GGI', 'SHK', 'E2', 'FLAKT', 'E1'], infantry, 'elite infantry'),
            vehicleLight: pick(['MTNK', 'LTNK', 'FV', 'HTK', 'IFV'], vehicles, 'light vehicle'),
            vehicleHeavy: pick(['HTNK', 'APOC', 'SREF', 'TTNK', 'GRIZ'], vehicles, 'heavy vehicle'),
        };
    }

    private static findNamedIndex(values: string[], candidates: string[]): number {
        const normalizedValues = values.map((value) => value.toLowerCase());
        for (const candidate of candidates) {
            const index = normalizedValues.indexOf(candidate.toLowerCase());
            if (index >= 0) {
                return index;
            }
        }
        return 0;
    }

    private static removeBaseUnit(game: Game, player: Player): void {
        const baseUnits = new Set(game.rules.general.baseUnit);
        player.getOwnedObjects()
            .filter((object: any) => object.isUnit?.() && baseUnits.has(object.name))
            .forEach((object: any) => {
                const type = object.type;
                game.destroyObject(object, undefined, true);
                // Initial construction vehicles are setup objects, not battle casualties.
                player.addUnitsLost(type, -1);
            });
    }

    private static pickHomeBaseName(rules: Rules, art: Art, theater: any, candidates: string[]): string {
        const imageFinder = new ImageFinder(Engine.getImages() as any, theater);
        const available = [...rules.buildingRules.keys()].filter((name) => {
            if (!art.hasObject(name, ObjectType.Building)) {
                return false;
            }
            return this.hasRenderableBuildingArt(art, imageFinder, name);
        });
        const preferred = candidates.find((candidate) => available.includes(candidate));
        if (preferred) {
            return preferred;
        }
        if (!available.length) {
            throw new Error('No available building art found for live interaction home base');
        }
        return available[0];
    }

    private static hasRenderableBuildingArt(art: Art, imageFinder: ImageFinder, buildingName: string): boolean {
        try {
            const objectArt = art.getObject(buildingName, ObjectType.Building);
            imageFinder.findByObjectArt(objectArt);
            if (objectArt.bibShape) {
                imageFinder.find(objectArt.bibShape, objectArt.useTheaterExtension);
            }
            const animProps = new BuildingAnimArtProps();
            animProps.read(objectArt.art, art);
            for (const anims of animProps.getAll().values()) {
                for (const anim of anims) {
                    imageFinder.find(anim.image, objectArt.useTheaterExtension);
                }
            }
            return true;
        } catch (error) {
            if (error instanceof MissingImageError) {
                return false;
            }
            throw error;
        }
    }

    private static findBasePlacementTile(gameMap: GameMap, rules: Rules, art: Art, buildingName: string, centerRx: number, centerRy: number): any {
        const buildingArt = art.getObject(buildingName, ObjectType.Building);
        const foundation = buildingArt.foundation;
        const foundationCenter = buildingArt.foundationCenter;
        const startRx = centerRx - foundationCenter.x;
        const startRy = centerRy - foundationCenter.y;
        const startTile = gameMap.tiles.getByMapCoords(startRx, startRy)
            ?? gameMap.tiles.getByMapCoords(startRx, startRy - 1)
            ?? gameMap.tiles.getByMapCoords(startRx, startRy + 1);
        if (!startTile) {
            return undefined;
        }
        const finder = new RadialTileFinder(
            gameMap.tiles as any,
            (gameMap as any).mapBounds,
            startTile,
            foundation,
            0,
            20,
            (tile: any) => this.canPlaceBuildingAt(gameMap, rules, art, buildingName, tile),
        );
        return finder.getNextTile();
    }

    private static canPlaceBuildingAt(gameMap: GameMap, rules: Rules, art: Art, buildingName: string, tile: any): boolean {
        const buildingRules = rules.getBuilding(buildingName) as TechnoRules;
        const foundation = art.getObject(buildingName, ObjectType.Building).foundation;
        for (let x = 0; x < foundation.width; x += 1) {
            for (let y = 0; y < foundation.height; y += 1) {
                const candidateTile = gameMap.tiles.getByMapCoords(tile.rx + x, tile.ry + y);
                if (!candidateTile) {
                    return false;
                }
                const groundObjects = gameMap.getGroundObjectsOnTile(candidateTile);
                const hasBlockingObject = groundObjects.some((obj: any) => {
                    if (obj.isBuilding?.() && obj.rules.invisibleInGame) {
                        return false;
                    }
                    return !obj.isSmudge?.();
                });
                if (hasBlockingObject) {
                    return false;
                }
                const landRules = rules.getLandRules(candidateTile.landType);
                if (buildingRules.waterBound) {
                    if (landRules.getSpeedModifier(SpeedType.Float) <= 0) {
                        return false;
                    }
                } else if (candidateTile.rampType !== 0 || !landRules.buildable) {
                    return false;
                }
            }
        }
        return true;
    }

    private static spawnHomeBase(game: Game, player: Player, buildingName: string, tile: any, label: string): any {
        const building = game.createObject(ObjectType.Building, buildingName);
        game.changeObjectOwner(building, player);
        building.purchaseValue = game.sellTrait.computePurchaseValue(building.rules, player);
        game.spawnObject(building, tile);
        building.setBuildStatus?.(BuildStatus.Ready, game);
        building.debugLabel = label;
        return building;
    }

    private static findNearestPassableTile(gameMap: GameMap, rx: number, ry: number, speedType: SpeedType = SpeedType.Foot, isInfantry = true): any {
        const baseTile = gameMap.tiles.getByMapCoords(rx, ry);
        const seedTile = baseTile ?? gameMap.tiles.getByMapCoords(rx, ry - 1) ?? gameMap.tiles.getByMapCoords(rx, ry + 1);
        if (!seedTile) {
            return undefined;
        }
        const finder = new RadialTileFinder(gameMap.tiles as any, (gameMap as any).mapBounds, seedTile, { width: 1, height: 1 }, 0, 12, (tile: any) => {
            return gameMap.terrain.getPassableSpeed(tile, speedType, isInfantry, !!tile.onBridgeLandType) > 0;
        });
        return finder.getNextTile();
    }

    private static measureViewport(): { x: number; y: number; width: number; height: number; } {
        const availableHeight = Math.max(1, Math.floor(window.innerHeight || DEFAULT_VIEWPORT_HEIGHT));
        const width = Math.max(1, Math.min(Math.floor(window.innerWidth || DEFAULT_VIEWPORT_WIDTH), Math.floor(availableHeight * 9 / 16)));
        const height = Math.max(1, Math.floor(width * 16 / 9));
        return { x: 0, y: 0, width, height };
    }

    private static computePanelWidth(viewport: { width: number; height: number; }): number {
        return Math.min(PANEL_WIDTH, Math.max(1, viewport.width - 24));
    }

    private static getReservedPanelWidth(viewport: { width: number; height: number; }): number {
        return 0;
    }

    private static computeBattleViewport(viewport: { x: number; y: number; width: number; height: number; }): { x: number; y: number; width: number; height: number; } {
        const reservedWidth = this.getReservedPanelWidth(viewport);
        return {
            x: viewport.x,
            y: viewport.y + 88,
            width: Math.max(1, viewport.width - reservedWidth),
            height: Math.max(1, viewport.height - 250),
        };
    }

    private static updatePanelLayout(viewport: { width: number; height: number; }): void {
        const panel = this.ui.panel;
        if (!panel) {
            return;
        }
        const panelWidth = this.computePanelWidth(viewport);
        const collapsedOffset = Math.max(0, panelWidth - PANEL_COLLAPSED_VISIBLE_WIDTH);
        panel.style.top = '88px';
        panel.style.right = `${PANEL_MARGIN}px`;
        panel.style.width = `${panelWidth}px`;
        panel.style.height = `${Math.max(100, viewport.height - 258)}px`;
        panel.style.visibility = this.panelCollapsed ? 'hidden' : 'visible';
        panel.style.transform = this.panelCollapsed ? `translateX(${collapsedOffset}px)` : 'translateX(0)';
        panel.dataset.collapsed = String(this.panelCollapsed);
        if (this.ui.panelContent) {
            this.ui.panelContent.style.opacity = this.panelCollapsed ? '0' : '1';
            this.ui.panelContent.style.pointerEvents = this.panelCollapsed ? 'none' : 'auto';
        }
        if (this.ui.panelToggle) {
            this.ui.panelToggle.textContent = this.panelCollapsed ? '◀' : '▶';
            this.ui.panelToggle.title = this.panelCollapsed ? '展开右侧工具栏' : '向右缩起工具栏';
        }
    }

    private static computeMinimapSize(viewport: { width: number; height: number; }): number {
        return Math.max(80, Math.min(160, Math.floor(viewport.width * 0.34)));
    }

    private static updateMinimapLayout(
        viewport: { x?: number; y?: number; width: number; height: number; },
        minimap: Minimap = this.battle?.minimap as Minimap,
        battleViewport: { x: number; y: number; width: number; height: number; } = this.computeBattleViewport({
            x: viewport.x ?? 0,
            y: viewport.y ?? 0,
            width: viewport.width,
            height: viewport.height,
        }),
    ): void {
        if (!minimap) {
            return;
        }
        const size = this.computeMinimapSize({ width: battleViewport.width, height: viewport.height });
        const x = Math.floor((viewport.width - size) / 2);
        const y = viewport.height - 176 - Math.floor(size * 0.6);
        minimap.setFitSize({ width: size, height: Math.floor(size * 0.6) });
        minimap.setPosition(x, y);
        minimap.setZIndex(6);

        if (this.ui.minimapShell) {
            this.ui.minimapShell.style.left = `${x}px`;
            this.ui.minimapShell.style.top = `${y}px`;
            this.ui.minimapShell.style.width = `${size}px`;
            this.ui.minimapShell.style.height = `${Math.floor(size * 0.6)}px`;
        }
    }

    private static getMinimapBounds(): { x: number; y: number; width: number; height: number; centerX: number; centerY: number; } | null {
        const battle = this.battle;
        if (!battle) {
            return null;
        }
        const battleViewport = this.computeBattleViewport(battle.uiScene.viewport);
        const size = this.computeMinimapSize({ width: battleViewport.width, height: battle.uiScene.viewport.height });
        const height = Math.floor(size * 0.6);
        const x = Math.floor((battle.uiScene.viewport.width - size) / 2);
        const y = battle.uiScene.viewport.height - 176 - height;
        return {
            x,
            y,
            width: size,
            height,
            centerX: x + size / 2,
            centerY: y + height / 2,
        };
    }

    private static installResponsiveViewport(): void {
        const onResize = () => this.syncBattleViewport();
        window.addEventListener('resize', onResize);
        this.disposables.add(() => window.removeEventListener('resize', onResize));
    }

    private static syncBattleViewport(forceFocus: boolean = false): void {
        const viewport = this.measureViewport();
        const battleViewport = this.computeBattleViewport(viewport);
        this.updatePanelLayout(viewport);
        this.renderer?.setSize(viewport.width, viewport.height);
        this.ui.host!.style.width = `${viewport.width}px`;
        this.ui.host!.style.height = `${viewport.height}px`;
        this.ui.host!.style.top = `${Math.floor((window.innerHeight - viewport.height) / 2)}px`;
        this.ui.canvasPane!.style.width = '100%';
        this.ui.canvasPane!.style.height = '100%';
        if (!this.battle) {
            return;
        }
        this.battle.canvasMetrics.notifyViewportChange();
        this.battle.uiScene.setViewport(viewport);
        this.battle.uiScene.setCamera(UiScene.createCamera(viewport));
        this.battle.worldView.handleViewportChange(battleViewport);
        this.updateMinimapLayout(viewport, this.battle.minimap, battleViewport);
        this.updateBattlePanLimits(this.battle.worldScene, this.battle.gameMap, this.battle.localBounds);
        if (forceFocus) {
            this.focusCenter(false);
            return;
        }
        this.clampBattleCamera();
        this.syncState();
    }

    private static focusTile(rx: number, ry: number): void {
        const battle = this.battle;
        if (!battle) {
            return;
        }
        const roundedRx = Math.round(rx);
        const roundedRy = Math.round(ry);
        const tile = battle.gameMap.tiles.getByMapCoords(roundedRx, roundedRy)
            ?? this.findNearestPassableTile(battle.gameMap, roundedRx, roundedRy, SpeedType.Track, false)
            ?? this.findNearestPassableTile(battle.gameMap, roundedRx, roundedRy);
        if (!tile) {
            return;
        }
        const panningHelper = new MapPanningHelper(battle.gameMap as any);
        battle.worldScene.cameraPan.setPan((panningHelper as any).computeCameraPanFromTile(tile.rx, tile.ry));
        this.clampBattleCamera();
        this.syncState();
    }

    private static setBattleZoom(targetZoom: number): void {
        const battle = this.battle;
        if (!battle) {
            return;
        }
        const minBattleZoom = this.computeMinBattleZoom(battle.worldScene.viewport, battle.gameMap, battle.localBounds);
        const clamped = Math.max(minBattleZoom, Math.min(MAX_BATTLE_ZOOM, targetZoom));
        if (Math.abs(clamped - battle.worldScene.cameraZoom.getZoom()) < 0.001) {
            return;
        }
        (battle.worldScene.cameraZoom as any).zoom = clamped;
        this.updateBattlePanLimits(battle.worldScene, battle.gameMap, battle.localBounds);
        this.clampBattleCamera();
    }

    private static clampBattleCamera(): void {
        const battle = this.battle;
        if (!battle) {
            return;
        }
        this.updateBattlePanLimits(battle.worldScene, battle.gameMap, battle.localBounds);
        battle.worldScene.cameraPan.setPan(battle.worldScene.cameraPan.getPan());
    }

    private static computeMapScreenBounds(bounds: { x: number; y: number; width: number; height: number; }): { x: number; y: number; width: number; height: number; } {
        const topLeft = IsoCoords.screenTileToScreen(bounds.x, bounds.y);
        const bottomRight = IsoCoords.screenTileToScreen(bounds.x + bounds.width, bounds.y + bounds.height - 1);
        return {
            x: topLeft.x,
            y: topLeft.y,
            width: bottomRight.x - topLeft.x,
            height: bottomRight.y - topLeft.y,
        };
    }

    private static computeRenderableScreenBounds(
        gameMap: GameMap,
        localBounds: { x: number; y: number; width: number; height: number; },
    ): { x: number; y: number; width: number; height: number; } {
        const rawLocalSize = (gameMap as any).mapBounds?.getRawLocalSize?.();
        if (!rawLocalSize) {
            return this.computeMapScreenBounds(localBounds);
        }
        return this.computeMapScreenBounds({
            x: 2 * rawLocalSize.x,
            y: 2 * rawLocalSize.y + 4,
            width: 2 * rawLocalSize.width,
            height: 2 * rawLocalSize.height + 8,
        });
    }

    private static computeMinBattleZoom(
        viewport: { width: number; height: number; },
        gameMap: GameMap,
        localBounds: { x: number; y: number; width: number; height: number; },
    ): number {
        const mapBounds = this.computeRenderableScreenBounds(gameMap, localBounds);
        const fitX = viewport.width / Math.max(1, mapBounds.width - 1);
        const fitY = viewport.height / Math.max(1, mapBounds.height - 1);
        return Math.max(MIN_BATTLE_ZOOM, Math.min(MAX_BATTLE_ZOOM, Math.max(fitX, fitY)));
    }

    private static updateBattlePanLimits(
        worldScene: any,
        gameMap: GameMap,
        localBounds: { x: number; y: number; width: number; height: number; },
    ): void {
        const viewport = worldScene.viewport;
        const zoom = Math.max(0.1, worldScene.cameraZoom.getZoom());
        const effectiveViewport = {
            ...viewport,
            width: viewport.width / zoom,
            height: viewport.height / zoom,
        };
        const panningHelper = new MapPanningHelper(gameMap as any);
        const mapBounds = this.computeRenderableScreenBounds(gameMap, localBounds);
        worldScene.cameraPan.setPanLimits((panningHelper as any).computeCameraPanLimits(effectiveViewport, mapBounds));
    }

    private static getCameraSafetyState(): Record<string, unknown> | null {
        const battle = this.battle;
        if (!battle) {
            return null;
        }
        const origin = IsoCoords.worldToScreen(0, 0);
        const pan = battle.worldScene.cameraPan.getPan();
        const zoom = battle.worldScene.cameraZoom.getZoom();
        const viewport = battle.worldScene.viewport;
        const center = {
            x: origin.x + pan.x,
            y: origin.y + pan.y,
        };
        const visibleRect = {
            x: center.x - viewport.width / (2 * zoom),
            y: center.y - viewport.height / (2 * zoom),
            width: viewport.width / zoom,
            height: viewport.height / zoom,
        };
        const mapBounds = this.computeRenderableScreenBounds(battle.gameMap, battle.localBounds);
        const tolerance = 1;
        return {
            origin,
            renderBounds: mapBounds,
            visibleRect,
            center,
            minZoom: this.computeMinBattleZoom(viewport, battle.gameMap, battle.localBounds),
            withinRenderableBounds:
                visibleRect.x >= mapBounds.x - tolerance &&
                visibleRect.y >= mapBounds.y - tolerance &&
                visibleRect.x + visibleRect.width <= mapBounds.x + mapBounds.width + tolerance &&
                visibleRect.y + visibleRect.height <= mapBounds.y + mapBounds.height + tolerance,
        };
    }

    private static createAttackMoveOrder(unit: any, targetBase: any, fallbackTile: any): AttackMoveOrder {
        if (!this.battle) {
            throw new Error('Battle context missing while creating attack-move order');
        }
        const target = this.battle.game.createTarget(targetBase, fallbackTile);
        return new AttackMoveOrder(this.battle.game, this.battle.gameMap).set(unit, target) as AttackMoveOrder;
    }

    private static getBaseStatus(base: any, label: string): {
        label: string;
        hpDisplay: string;
        isAlive: boolean;
        hitPoints: number;
        maxHitPoints: number;
    } {
        const hitPoints = Math.max(0, Math.floor(base?.healthTrait?.getHitPoints?.() ?? base?.healthTrait?.hitPoints ?? 0));
        const maxHitPoints = Math.max(1, Math.floor(base?.healthTrait?.maxHitPoints ?? hitPoints ?? 1));
        const displayHp = Math.max(0, Math.min(BASE_HP_DISPLAY_MAX, Math.round((hitPoints / maxHitPoints) * BASE_HP_DISPLAY_MAX)));
        return {
            label,
            hpDisplay: `${displayHp}/${BASE_HP_DISPLAY_MAX}`,
            isAlive: !!base && base.isSpawned && !base.isDestroyed,
            hitPoints,
            maxHitPoints,
        };
    }

    private static updateBaseLabels(): void {
        if (!this.battle) {
            return;
        }
        const leftBaseStatus = this.getBaseStatus(this.battle.leftBase, '红方老家');
        const rightBaseStatus = this.getBaseStatus(this.battle.rightBase, '蓝方老家');
        if (this.battle.leftBase) {
            this.battle.leftBase.debugLabel = `${leftBaseStatus.label}\n${leftBaseStatus.hpDisplay}`;
        }
        if (this.battle.rightBase) {
            this.battle.rightBase.debugLabel = `${rightBaseStatus.label}\n${rightBaseStatus.hpDisplay}`;
        }
    }

    private static renderBattleLabels(): void {
        const battle = this.battle;
        const overlayPane = this.ui.overlayPane;
        if (!battle || !overlayPane) {
            return;
        }
        overlayPane.replaceChildren();
        const appendLabel = (text: string, worldPos: any, color: string, emphasized: boolean = false) => {
            const point = this.projectWorldToViewport(worldPos);
            if (!point) {
                return;
            }
            const label = document.createElement('div');
            label.textContent = text;
            label.style.position = 'absolute';
            label.style.left = `${point.x}px`;
            label.style.top = `${point.y}px`;
            label.style.transform = 'translate(-50%, -100%)';
            label.style.whiteSpace = 'pre';
            label.style.padding = emphasized ? '6px 10px' : '4px 8px';
            label.style.border = `2px solid ${color}`;
            label.style.borderRadius = '6px';
            label.style.background = emphasized ? 'rgba(20, 10, 10, 0.82)' : 'rgba(12, 12, 12, 0.72)';
            label.style.color = '#fff7d1';
            label.style.fontWeight = emphasized ? '700' : '600';
            label.style.fontSize = emphasized ? '16px' : '14px';
            label.style.textShadow = '0 1px 2px rgba(0, 0, 0, 0.9)';
            label.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.35)';
            overlayPane.appendChild(label);
        };

        const leftBaseStatus = this.getBaseStatus(battle.leftBase, '红方老家');
        const rightBaseStatus = this.getBaseStatus(battle.rightBase, '蓝方老家');
        if (battle.leftBase?.position?.worldPosition) {
            appendLabel(`${leftBaseStatus.label}\n${leftBaseStatus.hpDisplay}`, battle.leftBase.position.worldPosition, '#ff6a6a', true);
        }
        if (battle.rightBase?.position?.worldPosition) {
            appendLabel(`${rightBaseStatus.label}\n${rightBaseStatus.hpDisplay}`, battle.rightBase.position.worldPosition, '#6ea8ff', true);
        }

        const namedUnits = [
            ...battle.leftPlayer.getOwnedObjects(),
            ...battle.rightPlayer.getOwnedObjects(),
        ].filter((object: any) => object.isUnit?.() && object.isSpawned && !object.isDestroyed && object.debugLabel);
        namedUnits.forEach((unit: any) => {
            appendLabel(unit.debugLabel, unit.position.worldPosition, unit.owner === battle.leftPlayer ? '#ff7f7f' : '#7fb0ff');
        });
    }

    private static projectWorldToViewport(worldPos: any): { x: number; y: number; } | undefined {
        const battle = this.battle;
        if (!battle || !worldPos) {
            return undefined;
        }
        const viewport = battle.worldScene.viewport;
        const projected = new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z).project(battle.worldScene.camera);
        if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !Number.isFinite(projected.z)) {
            return undefined;
        }
        const x = viewport.x + ((projected.x + 1) / 2) * viewport.width;
        const y = viewport.y + ((1 - projected.y) / 2) * viewport.height - 18;
        if (x < -120 || x > viewport.width + 120 || y < -120 || y > viewport.height + 120) {
            return undefined;
        }
        return { x, y };
    }

    private static toViewerLabel(uname?: string): string | undefined {
        const normalized = uname?.replace(/\s+/g, ' ').trim();
        if (!normalized) {
            return undefined;
        }
        return normalized.length > 10 ? normalized.slice(0, 10) : normalized;
    }

    private static followArmies(): void {
        const battle = this.battle;
        if (!battle || this.round.phase !== 'running' || Date.now() < this.cameraManualUntil) return;
        const points = (player: Player) => player.getOwnedObjects().filter((object: any) => object.isUnit?.() && object.isSpawned && !object.isDestroyed).map((object: any) => IsoCoords.vecWorldToScreen(object.position.worldPosition));
        const left = IsoCoords.vecWorldToScreen(battle.leftBase.position.worldPosition);
        const right = IsoCoords.vecWorldToScreen(battle.rightBase.position.worldPosition);
        const focus = armyFocus(points(battle.leftPlayer), points(battle.rightPlayer), { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 });
        const target = new MapPanningHelper(battle.gameMap as any).computeCameraPanFromScreen(focus);
        const current = battle.worldScene.cameraPan.getPan();
        battle.worldScene.cameraPan.setPan({ x: current.x + (target.x - current.x) * 0.045, y: current.y + (target.y - current.y) * 0.045 });
    }

    private static updateBattle(): void {
        const battle = this.battle;
        if (!battle || this.round.phase !== 'running') return;
        battle.game.update();
        if (!this.round.observe(this.getBaseStatus(battle.leftBase, '').isAlive, this.getBaseStatus(battle.rightBase, '').isAlive, Date.now())) return;
        battle.game.end();
        this.roundResults = this.contributions.freeze();
        this.showSettlement();
        this.appendLog('结算', this.round.winner === 'draw' ? '双方基地均被摧毁，本局平局。' : `${this.round.winner === 'left' ? '红方' : '蓝方'}获胜。`);
        this.syncState();
        this.restartTimer = window.setTimeout(() => {
            const restart = this.restart;
            if (!restart) return;
            void restart().catch((error: Error) => {
                this.state.runtimeStatus.lastError = `重新开局失败：${error.message}`;
                this.appendLog('系统', this.state.runtimeStatus.lastError);
                this.syncState();
            });
        }, Math.max(0, this.round.restartAt - Date.now()));
    }

    private static updateRoundSummary(): void {
        if (this.ui.settlementCountdown && this.round.phase === 'settling') this.ui.settlementCountdown.textContent = String(Math.max(0, Math.ceil((this.round.restartAt - Date.now()) / 1000)));
        if (!this.ui.roundSummary) return;
        const result = this.round.winner === 'draw' ? '平局' : this.round.winner === 'left' ? '红方获胜' : '蓝方获胜';
        this.ui.roundSummary.textContent = this.round.phase === 'settling'
            ? `第 ${this.round.id} 局 · ${result}\n${Math.max(0, Math.ceil((this.round.restartAt - Date.now()) / 1000))} 秒后开启下一局`
            : this.round.phase === 'running' ? `第 ${this.round.id} 局 · 对战中` : '正在准备战场';
    }

    private static startSimulationLoops(): void {
        if (!this.battle) {
            return;
        }
        this.gameTickTimer = window.setInterval(() => {
            try {
                this.updateBattle();
                this.updateRoundSummary();
                this.followArmies();
                this.clampBattleCamera();
                this.renderBattleLabels();
            } catch (error) {
                console.error('[LiveInteractionTester] game.update failed', error);
            }
        }, GAME_TICK_MS);
        this.orderRefreshTimer = window.setInterval(() => {
            this.refreshOrders();
            this.syncState();
        }, ORDER_REFRESH_MS);
        this.statusPollTimer = window.setInterval(() => {
            void this.fetchRuntimeStatus();
        }, STATUS_POLL_MS);
        this.disposables.add(() => {
            if (this.gameTickTimer) {
                clearInterval(this.gameTickTimer);
                this.gameTickTimer = undefined;
            }
        });
        this.disposables.add(() => {
            if (this.orderRefreshTimer) {
                clearInterval(this.orderRefreshTimer);
                this.orderRefreshTimer = undefined;
            }
        });
        this.disposables.add(() => {
            if (this.statusPollTimer) {
                clearInterval(this.statusPollTimer);
                this.statusPollTimer = undefined;
            }
        });
    }

    private static bindRuntimeBridge(): void {
        this.fetchRuntimeStatus().catch((error) => {
            console.warn('[LiveInteractionTester] Failed to query runtime status', error);
            this.state.runtimeStatus.lastError = '未连接到本地直播运行时，请通过 bun run live:runtime 启动。';
            this.syncState();
        });
        try {
            const eventSource = new EventSource(`${API_BASE}/events`);
            this.eventSource = eventSource;
            eventSource.addEventListener('status', (event) => {
                const payload = JSON.parse((event as MessageEvent).data) as RuntimeStatus;
                this.state.runtimeStatus = payload;
                this.syncState();
            });
            eventSource.addEventListener('interaction', (event) => {
                const payload = JSON.parse((event as MessageEvent).data) as NormalizedInteractionEvent;
                this.handleInteractionEvent(payload);
            });
            eventSource.onerror = () => {
                this.state.runtimeStatus = {
                    ...this.state.runtimeStatus,
                    connected: false,
                    sessionActive: false,
                    lastError: '事件流连接中断，请确认本地运行时仍在运行。',
                };
                this.syncState();
            };
            this.disposables.add(() => eventSource.close());
        } catch (error) {
            console.warn('[LiveInteractionTester] Failed to initialize EventSource bridge', error);
        }
    }

    private static async fetchRuntimeStatus(): Promise<void> {
        const status = await this.postJson(`${API_BASE}/status`, undefined, 'GET') as RuntimeStatus;
        this.state.runtimeStatus = status;
        this.syncState();
    }

    private static async handleConnect(): Promise<void> {
        const mode = this.state.mode;
        const payload = mode === 'live'
            ? {
                mode,
                appId: this.ui.appIdInput?.value.trim(),
                accessKeyId: this.ui.accessKeyIdInput?.value.trim(),
                accessSecret: this.ui.accessSecretInput?.value.trim(),
                code: this.ui.codeInput?.value.trim(),
            }
            : { mode };
        try {
            const status = await this.postJson(`${API_BASE}/connect`, payload);
            this.state.runtimeStatus = status as RuntimeStatus;
            this.appendLog('系统', mode === 'live' ? '已发起 B 站直播连接。' : '已切换到本地模拟模式。');
        } catch (error: any) {
            this.appendLog('系统', `连接失败: ${error?.message || error}`);
            this.state.runtimeStatus.lastError = String(error?.message || error);
        }
        this.syncState();
    }

    private static async handleDisconnect(): Promise<void> {
        try {
            const status = await this.postJson(`${API_BASE}/disconnect`, {});
            this.state.runtimeStatus = status as RuntimeStatus;
            this.appendLog('系统', '直播互动连接已断开。');
        } catch (error: any) {
            this.appendLog('系统', `断开失败: ${error?.message || error}`);
            this.state.runtimeStatus.lastError = String(error?.message || error);
        }
        this.syncState();
    }

    private static async handleUiAction(action: string): Promise<void> {
        switch (action) {
            case 'toggle-panel':
                this.panelCollapsed = !this.panelCollapsed;
                this.syncBattleViewport();
                return;
            case 'mock-room-enter':
                await this.emitMockEvent('room-enter', { uname: '观众A' });
                return;
            case 'mock-like':
                await this.emitMockEvent('like', { uname: '观众B', likeCount: 3 });
                return;
            case 'mock-gift':
                await this.emitMockEvent('gift', { uname: '礼物观众', giftName: '测试礼物', giftNum: 5, price: 1, totalPrice: 5 });
                return;
            case 'mock-guard':
                await this.emitMockEvent('guard', { uname: '总督', guardLevel: 3, totalPrice: 2000 });
                return;
            case 'mock-super-chat':
                await this.emitMockEvent('super-chat', { uname: '醒目留言用户', price: 30, totalPrice: 3000, message: '蓝军冲锋' });
                return;
            case 'mock-danmaku-left':
                await this.emitMockEvent('danmaku', { uname: '红方弹幕观众', openId: 'mock:red-danmaku', message: '红军 进攻' });
                return;
            case 'mock-danmaku-right':
                await this.emitMockEvent('danmaku', { uname: '蓝方弹幕观众', openId: 'mock:blue-danmaku', message: '蓝军 冲锋' });
                return;
            case 'mock-danmaku-custom':
                await this.emitMockEvent('danmaku', {
                    uname: '自定义弹幕',
                    message: this.ui.danmakuInput?.value.trim() || '红军 支援',
                });
                return;
            case 'focus-center':
                this.focusCenter();
                return;
            default:
                return;
        }
    }

    private static async emitMockEvent(kind: InteractionKind, payload: Record<string, unknown>): Promise<void> {
        try {
            const status = await this.postJson(`${API_BASE}/mock`, { kind, ...payload });
            if (status && typeof status === 'object' && 'mode' in status) {
                this.state.runtimeStatus = status as RuntimeStatus;
            }
        } catch (error: any) {
            this.appendLog('系统', `发送 mock 事件失败: ${error?.message || error}`);
            this.state.runtimeStatus.lastError = String(error?.message || error);
            this.syncState();
        }
    }

    private static async postJson(url: string, payload?: unknown, method: 'GET' | 'POST' = 'POST'): Promise<unknown> {
        const response = await fetch(url, {
            method,
            headers: payload !== undefined ? { 'Content-Type': 'application/json' } : undefined,
            body: payload !== undefined ? JSON.stringify(payload) : undefined,
        });
        const text = await response.text();
        const parsed = text ? JSON.parse(text) : null;
        if (!response.ok) {
            const message = parsed?.error || parsed?.message || text || response.statusText;
            throw new Error(message);
        }
        return parsed;
    }

    private static handleInteractionEvent(event: NormalizedInteractionEvent): void {
        if (this.round.phase !== 'running' || event.timestamp < this.round.startedAt || this.seenEvents.has(event.id)) return;
        this.seenEvents.add(event.id);
        if (this.seenEvents.size > 5000) this.seenEvents.delete(this.seenEvents.values().next().value!);
        this.state.lastEvent = event;
        this.state.runtimeStatus.eventCount = Math.max(this.state.runtimeStatus.eventCount, (this.state.runtimeStatus.eventCount ?? 0) + 1);
        this.state.runtimeStatus.lastEventAt = event.timestamp;
        const plan = this.resolveWavePlan(event);
        if (!plan) {
            this.appendLog('事件', `${event.cmd} 已接收，但当前未配置为出兵。`);
            this.syncState();
            return;
        }
        plan.side = this.contributions.sideFor(event.openId) ?? plan.side;
        this.contributions.credit(event, plan.side);
        this.spawnWave(plan);
        this.appendLog('事件', this.describeEvent(event, plan));
        this.syncState();
    }

    private static resolveWavePlan(event: NormalizedInteractionEvent): WavePlan | null {
        const viewerLabel = this.toViewerLabel(event.uname);
        switch (event.kind) {
            case 'room-enter':
                return { side: 'left', reason: '进房', infantryBasic: 1, viewerLabel };
            case 'like': {
                const likeCount = Math.max(1, Math.min(5, event.likeCount ?? 1));
                return { side: 'left', reason: '点赞', infantryBasic: likeCount, viewerLabel };
            }
            case 'gift': {
                const totalPrice = event.totalPrice ?? (event.price ?? 0) * (event.giftNum ?? 1);
                if (totalPrice >= 2000) {
                    return { side: 'right', reason: '高价值礼物', infantryElite: 6, vehicleHeavy: 2, veteran: true, viewerLabel };
                }
                if (totalPrice >= 500) {
                    return { side: 'right', reason: '礼物', infantryElite: 3, vehicleLight: 1, veteran: true, viewerLabel };
                }
                return { side: 'right', reason: '礼物', infantryElite: 2, viewerLabel };
            }
            case 'guard':
                return { side: 'right', reason: '上舰', infantryElite: 5, vehicleHeavy: 1, veteran: true, viewerLabel };
            case 'super-chat':
                return { side: 'right', reason: '醒目留言', infantryElite: 4, vehicleHeavy: 2, veteran: true, viewerLabel };
            case 'danmaku': {
                const message = event.message?.toLowerCase() ?? '';
                const side = message.includes('蓝') || message.includes('下') || message.includes('right') || message.includes('blue') || message.includes('bottom')
                    ? 'right'
                    : 'left';
                const premium = message.includes('坦克') || message.includes('tank');
                return premium
                    ? { side, reason: '弹幕指令', infantryBasic: 2, vehicleLight: 1, viewerLabel }
                    : { side, reason: '弹幕指令', infantryBasic: 2, viewerLabel };
            }
            case 'live-start':
                return { side: 'left', reason: '开播', infantryBasic: 3, vehicleLight: 1, viewerLabel };
            case 'live-end':
                return { side: 'right', reason: '下播', infantryElite: 3, vehicleHeavy: 1, viewerLabel };
            default:
                return null;
        }
    }

    private static spawnWave(plan: WavePlan): void {
        const battle = this.battle;
        if (!battle) {
            return;
        }
        const sidePlayer = plan.side === 'left' ? battle.leftPlayer : battle.rightPlayer;
        const enemyBase = plan.side === 'left' ? battle.rightBase : battle.leftBase;
        const targetTile = plan.side === 'left' ? battle.leftTarget : battle.rightTarget;
        const spawnAnchor = plan.side === 'left' ? battle.leftAnchor : battle.rightAnchor;
        const unitCatalog = battle.unitCatalog;
        let spawned = 0;
        const batchIds = new Set<string>();
        let remainingLabels = plan.viewerLabel ? MAX_UNIT_LABELS_PER_WAVE : 0;
        const spawnUnitBatch = (unitName: string, count: number) => {
            if (!count) {
                return;
            }
            const unitRules = battle.game.rules.getObject(unitName, unitName === unitCatalog.infantryBasic || unitName === unitCatalog.infantryElite ? ObjectType.Infantry : ObjectType.Vehicle);
            const spawnTiles = this.findSpawnTiles(spawnAnchor, count, unitRules, batchIds);
            let infantrySpawnIndex = 0;
            for (let index = 0; index < spawnTiles.length; index += 1) {
                const tile = spawnTiles[index];
                const unit = battle.game.createUnitForPlayer(unitRules, sidePlayer);
                if (unit.isInfantry?.()) {
                    unit.position.subCell = Infantry.SUB_CELLS[infantrySpawnIndex % Infantry.SUB_CELLS.length];
                    infantrySpawnIndex += 1;
                }
                battle.game.spawnObject(unit, tile);
                spawned++;
                if (plan.veteran && unit.veteranTrait?.setVeteranLevel) {
                    unit.veteranTrait.setVeteranLevel(1);
                }
                if (remainingLabels > 0 && plan.viewerLabel) {
                    unit.debugLabel = plan.viewerLabel;
                    remainingLabels -= 1;
                }
                const order = this.createAttackMoveOrder(unit, enemyBase, targetTile);
                unit.unitOrderTrait.addOrder(order as any, false);
            }
        };
        spawnUnitBatch(unitCatalog.vehicleHeavy, plan.vehicleHeavy ?? 0);
        spawnUnitBatch(unitCatalog.vehicleLight, plan.vehicleLight ?? 0);
        spawnUnitBatch(unitCatalog.infantryElite, plan.infantryElite ?? 0);
        spawnUnitBatch(unitCatalog.infantryBasic, plan.infantryBasic ?? 0);
        const sideStats = plan.side === 'left' ? this.state.left : this.state.right;
        sideStats.totalSpawned += spawned;
        sideStats.lastReinforcementAt = Date.now();
    }

    private static findSpawnTiles(anchorTile: any, count: number, unitRules: any, usedKeys: Set<string>): any[] {
        const battle = this.battle;
        if (!battle) {
            return [];
        }
        const finder = new RadialTileFinder(
            battle.gameMap.tiles as any,
            (battle.gameMap as any).mapBounds,
            anchorTile,
            { width: 1, height: 1 },
            0,
            10,
            (tile: any) => {
                const key = `${tile.rx}:${tile.ry}`;
                if (usedKeys.has(key)) {
                    return false;
                }
                return battle.gameMap.terrain.getPassableSpeed(tile, unitRules.speedType, unitRules.type === ObjectType.Infantry, !!tile.onBridgeLandType) > 0;
            },
        );
        const tiles: any[] = [];
        for (let index = 0; index < count; index += 1) {
            const tile = finder.getNextTile();
            if (!tile) {
                break;
            }
            tiles.push(tile);
            usedKeys.add(`${tile.rx}:${tile.ry}`);
        }
        return tiles;
    }

    private static refreshOrders(): void {
        const battle = this.battle;
        if (!battle || this.round.phase !== 'running') {
            return;
        }
        const refreshSide = (player: Player, targetBase: any, targetTile: any) => {
            player.getOwnedObjects()
                .filter((object: any) => object.isUnit?.() && object.isSpawned && !object.isDestroyed)
                .forEach((unit: any) => {
                    if (!unit.unitOrderTrait?.isIdle?.()) {
                        return;
                    }
                    if (!unit.attackTrait || !unit.moveTrait) {
                        return;
                    }
                    const order = this.createAttackMoveOrder(unit, targetBase, targetTile);
                    unit.unitOrderTrait.addOrder(order as any, false);
                });
        };
        refreshSide(battle.leftPlayer, battle.rightBase, battle.leftTarget);
        refreshSide(battle.rightPlayer, battle.leftBase, battle.rightTarget);
    }

    private static computeOverviewZoom(): number {
        const battle = this.battle;
        if (!battle) {
            return 0.9;
        }
        return this.computeMinBattleZoom(battle.worldScene.viewport, battle.gameMap, battle.localBounds);
    }

    private static computeOverviewPan(): { x: number; y: number; } {
        const battle = this.battle;
        if (!battle) {
            return { x: 0, y: 0 };
        }
        const limits = battle.worldScene.cameraPan.getPanLimits?.();
        if (limits && Number.isFinite(limits.x) && Number.isFinite(limits.y) && Number.isFinite(limits.width) && Number.isFinite(limits.height)) {
            return {
                x: limits.x + limits.width / 2,
                y: limits.y + limits.height / 2,
            };
        }
        const panningHelper = new MapPanningHelper(battle.gameMap as any);
        return panningHelper.computeCameraPanFromTile(battle.centerTile.rx, battle.centerTile.ry);
    }

    private static focusCenter(withLog: boolean = true): void {
        const battle = this.battle;
        if (!battle) {
            return;
        }
        this.setBattleZoom(this.computeOverviewZoom());
        const left = IsoCoords.vecWorldToScreen(battle.leftBase.position.worldPosition);
        const right = IsoCoords.vecWorldToScreen(battle.rightBase.position.worldPosition);
        const helper = new MapPanningHelper(battle.gameMap as any);
        battle.worldScene.cameraPan.setPan(helper.computeCameraPanFromScreen({ x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 }));
        this.cameraManualUntil = withLog ? Date.now() + 4000 : 0;
        this.clampBattleCamera();
        this.syncState();
        if (withLog) {
            this.appendLog('系统', '镜头已切到战场总览，可拖拽继续查看细节。');
        }
    }

    private static describeEvent(event: NormalizedInteractionEvent, plan: WavePlan): string {
        const source = event.uname ? `${event.uname}` : '匿名观众';
        const sideLabel = plan.side === 'left' ? '红方左侧' : '蓝方右侧';
        const units: string[] = [];
        if (plan.infantryBasic) {
            units.push(`基础步兵 x${plan.infantryBasic}`);
        }
        if (plan.infantryElite) {
            units.push(`精英步兵 x${plan.infantryElite}`);
        }
        if (plan.vehicleLight) {
            units.push(`轻装甲 x${plan.vehicleLight}`);
        }
        if (plan.vehicleHeavy) {
            units.push(`重装甲 x${plan.vehicleHeavy}`);
        }
        return `${source} 触发 ${plan.reason}，${sideLabel} 出兵: ${units.join(' / ')}`;
    }

    private static appendLog(tag: string, text: string): void {
        const at = Date.now();
        this.state.recentEvents.unshift({ at, text: `[${tag}] ${text}` });
        this.state.recentEvents = this.state.recentEvents.slice(0, MAX_LOG_ENTRIES);
        const log = this.ui.log;
        if (!log) {
            return;
        }
        log.replaceChildren();
        this.state.recentEvents.forEach((entry) => {
            const row = document.createElement('div');
            row.textContent = `${new Date(entry.at).toLocaleTimeString()} ${entry.text}`;
            row.style.padding = '6px 8px';
            row.style.border = '1px solid rgba(255, 184, 74, 0.2)';
            row.style.background = 'rgba(0, 0, 0, 0.16)';
            log.appendChild(row);
        });
    }

    private static syncState(): void {
        this.updateRoundSummary();
        this.updateBroadcastHud();
        const battle = this.battle;
        const leftAlive = battle ? this.countAliveUnits(battle.leftPlayer) : 0;
        const rightAlive = battle ? this.countAliveUnits(battle.rightPlayer) : 0;
        const leftLost = battle ? battle.leftPlayer.getUnitsLost() : 0;
        const rightLost = battle ? battle.rightPlayer.getUnitsLost() : 0;
        const leftBaseStatus = this.getBaseStatus(battle?.leftBase, '红方老家');
        const rightBaseStatus = this.getBaseStatus(battle?.rightBase, '蓝方老家');
        const runtimeStatus = this.state.runtimeStatus;
        const viewport = this.measureViewport();
        const battleViewport = battle?.worldScene?.viewport ?? this.computeBattleViewport(viewport);
        const cameraSafety = this.getCameraSafetyState();

        this.updateBaseLabels();
        this.renderBattleLabels();

        if (this.ui.statusBadge) {
            this.ui.statusBadge.textContent = runtimeStatus.lastError
                ? `状态: ${runtimeStatus.lastError}`
                : runtimeStatus.sessionActive
                    ? runtimeStatus.mode === 'mock' ? '状态: 本地模拟进行中' : `状态: 已连接直播间 ${runtimeStatus.anchor?.roomId ?? '-'}`
                    : runtimeStatus.connected
                        ? `状态: ${runtimeStatus.mode === 'mock' ? '本地模拟已就绪' : '直播连接中'}`
                        : '状态: 未连接本地运行时';
        }
        if (this.ui.statusSummary) {
            this.ui.statusSummary.textContent = [
                '运行时',
                `模式: ${runtimeStatus.mode}`,
                `连接: ${runtimeStatus.connected ? '已连接' : '未连接'}`,
                `场次: ${runtimeStatus.sessionActive ? '进行中' : '未开始'}`,
                `房间: ${runtimeStatus.anchor?.roomId ?? '-'}`,
                `主播: ${runtimeStatus.anchor?.uname ?? '-'}`,
                `累计事件: ${runtimeStatus.eventCount ?? 0}`,
            ].join('\n');
        }
        if (this.ui.leftSummary) {
            this.ui.leftSummary.textContent = [
                '红方左侧老家',
                `基地血量: ${leftBaseStatus.hpDisplay}`,
                `存活单位: ${leftAlive}`,
                `累计出兵: ${this.state.left.totalSpawned}`,
                `累计阵亡: ${leftLost}`,
                `最近增援: ${this.formatTime(this.state.left.lastReinforcementAt)}`,
            ].join('\n');
        }
        if (this.ui.rightSummary) {
            this.ui.rightSummary.textContent = [
                '蓝方右侧老家',
                `基地血量: ${rightBaseStatus.hpDisplay}`,
                `存活单位: ${rightAlive}`,
                `累计出兵: ${this.state.right.totalSpawned}`,
                `累计阵亡: ${rightLost}`,
                `最近增援: ${this.formatTime(this.state.right.lastReinforcementAt)}`,
            ].join('\n');
        }

        TestToolSupport.setState(TOOL_NAME, {
            ready: this.state.ready,
            mode: this.state.mode,
            runtimeStatus,
            eventCount: runtimeStatus.eventCount ?? 0,
            camera: battle ? {
                pan: battle.worldScene.cameraPan.getPan(),
                zoom: battle.worldScene.cameraZoom.getZoom(),
                viewport: battle.worldScene.viewport,
            } : null,
            cameraSafety,
            layout: {
                panelCollapsed: this.panelCollapsed,
                panelWidth: this.computePanelWidth(viewport),
                reservedPanelWidth: this.getReservedPanelWidth(viewport),
                windowViewport: viewport,
                battleViewport,
            },
            minimap: {
                ready: !!battle?.minimap,
                bounds: this.getMinimapBounds(),
            },
            left: {
                aliveUnits: leftAlive,
                totalSpawned: this.state.left.totalSpawned,
                unitsLost: leftLost,
                baseHealth: leftBaseStatus,
            },
            right: {
                aliveUnits: rightAlive,
                totalSpawned: this.state.right.totalSpawned,
                unitsLost: rightLost,
                baseHealth: rightBaseStatus,
            },
            top: {
                aliveUnits: leftAlive,
                totalSpawned: this.state.left.totalSpawned,
                unitsLost: leftLost,
                baseHealth: leftBaseStatus,
            },
            bottom: {
                aliveUnits: rightAlive,
                totalSpawned: this.state.right.totalSpawned,
                unitsLost: rightLost,
                baseHealth: rightBaseStatus,
            },
            lastEvent: this.state.lastEvent,
            recentEvents: this.state.recentEvents,
        });
    }

    private static countAliveUnits(player: Player): number {
        return player.getOwnedObjects().filter((object: any) => object.isUnit?.() && object.isSpawned && !object.isDestroyed).length;
    }

    private static formatTime(value?: number): string {
        if (!value) {
            return '-';
        }
        return new Date(value).toLocaleTimeString();
    }

    private static getDebugSnapshot(): Record<string, unknown> {
        const battle = this.battle;
        const viewport = this.measureViewport();
        const battleViewport = battle?.worldScene?.viewport ?? this.computeBattleViewport(viewport);
        const cameraSafety = this.getCameraSafetyState();
        return {
            round: { ...this.round },
            contributions: this.contributions.ranking(),
            ready: this.state.ready,
            mode: this.state.mode,
            runtimeStatus: this.state.runtimeStatus,
            camera: battle ? {
                pan: battle.worldScene.cameraPan.getPan(),
                zoom: battle.worldScene.cameraZoom.getZoom(),
                viewport: battle.worldScene.viewport,
            } : null,
            cameraSafety,
            layout: {
                panelCollapsed: this.panelCollapsed,
                panelWidth: this.computePanelWidth(viewport),
                reservedPanelWidth: this.getReservedPanelWidth(viewport),
                windowViewport: viewport,
                battleViewport,
            },
            minimap: {
                ready: !!battle?.minimap,
                bounds: this.getMinimapBounds(),
            },
            left: {
                totalSpawned: this.state.left.totalSpawned,
                aliveUnits: battle ? this.countAliveUnits(battle.leftPlayer) : 0,
                unitsLost: battle ? battle.leftPlayer.getUnitsLost() : 0,
                baseHealth: this.getBaseStatus(battle?.leftBase, '红方老家'),
            },
            right: {
                totalSpawned: this.state.right.totalSpawned,
                aliveUnits: battle ? this.countAliveUnits(battle.rightPlayer) : 0,
                unitsLost: battle ? battle.rightPlayer.getUnitsLost() : 0,
                baseHealth: this.getBaseStatus(battle?.rightBase, '蓝方老家'),
            },
            lastEvent: this.state.lastEvent,
            recentEvents: this.state.recentEvents,
        };
    }
}
