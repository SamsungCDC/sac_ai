import { useEffect, useRef, useState } from "react";

/* ---------------- Types ---------------- */
type Role = "user" | "assistant";
interface Message { role: Role; content: string | object | any[]; }

interface VocItem {
  voc_id: number;
  old_voc_id?: string | null;
  title: string;
  body?: string | null;
  manager_name?: string | null;
  type: string;
  request_lv1: string;
  request_lv2: string;
  request_date: string | null;
  completed_at: string | null;
  first_response_at: string | null;
  channel: string | null;
  last_dept?: string | null;
  requestor_email: string | null;
  urgency?: string | null;
  update_deploy_at?: string | null;
  request_description: string | null;
  response_description: string | null;
  status: string;
  sla_hr?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

type TaskMode = "GENERAL" | "QUERY_LIST" | "QUERY_SIMILAR";

interface VocHistory {
  history_id: number;
  voc_id: number;
  field_name: string;
  original_value: string | null;
  updated_value: string | null;
  updated_date: string | null;
}

interface VocDetail extends Partial<VocItem> {
  requestor_name?: string | null;
  history?: VocHistory[];
}

/* ---------------- Utils ---------------- */
const isVocObject = (d: any): d is VocItem => d && typeof d === "object" && "voc_id" in d;
const isVocArray  = (d: any): d is VocItem[] => Array.isArray(d) && d.length > 0 && isVocObject(d[0]);
const pretty = (o: any) => { try { return JSON.stringify(o, null, 2); } catch { return String(o); } };

// "YYYY-MM-DD HH:mm:ss+09:00" (KST)
const nowKSTString = () => {
  const kst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${kst.getFullYear()}-${pad(kst.getMonth()+1)}-${pad(kst.getDate())} ${pad(kst.getHours())}:${pad(kst.getMinutes())}:${pad(kst.getSeconds())}+09:00`;
};

// ▼ 표의 description 컬럼 기준 라벨 매핑
const FIELD_LABELS: Record<string, string> = {
  voc_id: "고유 식별자",
  old_voc_id: "마이그레이션 voc id",
  title: "제목",
  body: "voc 요청 내용",
  manager_name: "담당자",
  type: "분류",
  request_lv1: "문의유형1",
  request_lv2: "문의유형2",
  request_date: "요청일",
  completed_at: "처리완료일자",
  first_response_at: "최초대응시간",
  channel: "연관모듈(채널)",
  last_dept: "최종이관부서",
  requestor_email: "요청자 email",
  urgency: "우선순위(긴급도)",
  update_deploy_at: "수정배포일자",
  request_description: "요청내용상세",
  response_description: "대응방안(처리내용상세)",
  status: "처리상태",
  sla_hr: "( 처리완료일자 - 요청일 )",
  created_at: "생성일",
  updated_at: "변경일",
  // 혹시 서버에서 updated_deploy_at(철자 상이)로 줄 때 대비
  updated_deploy_at: "수정배포일자",
};

// 필드키 → 라벨 (없으면 원문 키 그대로)
const labelFor = (key: string) => FIELD_LABELS[key] ?? key;

// mode별 시스템 프롬프트
const buildPrompt = (mode: TaskMode) => {
  if (mode === "QUERY_LIST") {
    const NOW_KST = nowKSTString();
    return [
      'You are an API call composer. Return ONLY a JSON object matching this schema:',
      '{"method":"GET"|"POST"|"PATCH","endpoint":"/voc-data"|"/voc-data/{id}","params":{},"payload":{}}',
      'Rules:',
      '- Output ONLY the JSON object. No prose.',
      '- Prefer GET /voc-data for list queries.',
      '- Include only mentioned keys; do not invent values.',
      '- Defaults if not specified: page=1,size=20,sort="request_date,desc".',
      `- All datetimes: "YYYY-MM-DD HH:mm:ss+09:00" (Asia/Seoul). NOW_KST: ${NOW_KST}.`,
      'ACCEPTED GET params:',
      '- q,status[complete|close|pending|in progress],type[email|it|self]',
      '- channel[toolmate|sfdc|gmapda|gmapvd|gmapmx|tnp|sba|ecims|jcext|oms|slap|wmc|mypjt|sipms|ebiz|mps|pehs|cpcex]',
      '- request_lv1[sys_func_inquiry|data|func_improvement_dev|etc]',
      '- request_lv2[sign_up|login|my_page|life_cycle|approval_grant|provisioning|data_extract|update_delete|screen_improvement|func_improvement|etc]',
      '- requestor_email, request_date_from/to, completed_at_from/to, first_response_at_from/to, updated_deploy_at_from/to, page,size,sort',
      'KOREAN→ENUM:',
      '- status: 완료/처리완료→complete, 종료/미응답→close, 대기→pending, 진행/진행중→in progress',
      '- lv1: 시스템/기능 문의→sys_func_inquiry, 데이터→data, 기능개선/신규개발→func_improvement_dev, 기타→etc',
      '- lv2: 가입→sign_up, 로그인/2FA→login, 마이페이지→my_page, 라이프사이클→life_cycle, 승인/권한→approval_grant, 프로비저닝→provisioning, 추출→data_extract, 수정/삭제→update_delete, 화면 개선→screen_improvement, 기능 개선→func_improvement, 기타→etc',
      '- type: 이메일→email, IT-VoC→it, 직접인입→self',
      'DATE:',
      '- "오늘" → [today 00:00:00+09:00, today 23:59:59+09:00]',
      '- "어제부터 오늘까지" → [yesterday 00:00:00+09:00, today 23:59:59+09:00]',
      '- "최근 N일" → [NOW_KST-(N-1)d 00:00:00+09:00, today 23:59:59+09:00]',
      '- single day (e.g., 9/29) → that day\'s [00:00:00,23:59:59]'
    ].join('\n');
  }
  return 'You are a helpful assistant for Samsung CIAM VoC. Answer clearly and concisely.';
};

// OpenAI 스타일 응답(content) 추출 (GENERAL 대응)
const getOpenAIMessageContent = (data: any): string | null => {
  try {
    const m = data?.choices?.[0]?.message;
    const content = m?.content ?? null;
    if (typeof content === "string") return content;
    return content ? pretty(content) : null;
  } catch {
    return null;
  }
};

// 줄바꿈 정리
const nl = (s?: string | null) => (s ?? "").replace(/\r\n/g, "\n").trim();

/* ---------------- UI Parts ---------------- */
function Bubble({ role, children }: { role: Role; children: React.ReactNode }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} animate-[slideIn_0.3s_ease-out]`}>
      <div
        className={[
          "max-w-[85%] rounded-3xl px-5 py-4 shadow-lg backdrop-blur-xl transition-all hover:shadow-xl",
          isUser
            ? "bg-gradient-to-br from-sky-500 via-blue-500 to-cyan-600 text-white border border-white/20"
            : "bg-white/90 text-slate-800 border border-slate-200/60"
        ].join(" ")}
      >
        <div className={`text-xs font-semibold mb-2 ${isUser ? "text-white/90" : "text-slate-500"}`}>
          {isUser ? "👤 나" : "🤖 AI Assistant"}
        </div>
        <div className="whitespace-pre-wrap leading-relaxed text-base">{children}</div>
      </div>
    </div>
  );
}

function Chip({ children, color }: { children: React.ReactNode; color: "purple"|"blue"|"green"|"amber" }) {
  const styles = {
    purple: "bg-purple-100 text-purple-700 border-purple-300",
    blue:   "bg-blue-100 text-blue-700 border-blue-300",
    green:  "bg-emerald-100 text-emerald-700 border-emerald-300",
    amber:  "bg-amber-100 text-amber-700 border-amber-300",
  }[color];
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${styles}`}>
      {children}
    </span>
  );
}

function VocCard({ voc, onClick }: { voc: VocItem; onClick?: () => void }) {
  const getStatusColor = (status: string | null) => {
    if (!status) return "bg-slate-100 text-slate-600 border-slate-200";
    const s = status.replace("_", " ");
    if (s === "완료" || s === "처리완료" || s === "complete") return "bg-emerald-100 text-emerald-700 border-emerald-300";
    if (s.includes("진행") || s === "처리중" || s === "in progress") return "bg-blue-100 text-blue-700 border-blue-300";
    if (s === "대기" || s === "pending") return "bg-amber-100 text-amber-700 border-amber-300";
    if (s === "close" || s === "종료" || s === "미응답") return "bg-slate-200 text-slate-700 border-slate-300";
    return "bg-slate-100 text-slate-600 border-slate-200";
  };

  const getUrgencyColor = (urgency: string | null) => {
    if (!urgency) return "";
    if ((urgency || "").match(/P1|긴급|높음/i)) return "bg-red-100 text-red-700 border-red-300";
    if ((urgency || "").match(/P2|보통/i)) return "bg-blue-100 text-blue-700 border-blue-300";
    return "bg-slate-100 text-slate-600 border-slate-200";
  };

  return (
    <div
      className="p-5 bg-white rounded-2xl shadow-md border-2 border-slate-200 w-full hover:shadow-lg transition-all duration-200
                 cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }}
      aria-label={`VOC 상세 보기: #${voc.voc_id}`}
    >
      {/* Header: Title + ID */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-bold text-lg text-slate-900 leading-snug flex-1">
          {voc.title || "(제목 없음)"}
        </h3>
        <span className="text-xs px-3 py-1 rounded-lg bg-slate-700 text-white font-bold shrink-0">
          #{voc.voc_id}
        </span>
      </div>

      {/* Tags Row */}
      <div className="flex flex-wrap gap-2 mb-4">
        {voc.type && <Chip color="purple">{voc.type}</Chip>}
        {voc.status && (
          <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(voc.status)}`}>
            {voc.status}
          </span>
        )}
        {voc.urgency && (
          <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getUrgencyColor(voc.urgency)}`}>
            🔥 {voc.urgency}
          </span>
        )}
        {voc.channel && <Chip color="blue">{voc.channel}</Chip>}
        {voc.request_lv1 && <Chip color="green">{voc.request_lv1}</Chip>}
        {voc.request_lv2 && <Chip color="amber">{voc.request_lv2}</Chip>}
      </div>

      {/* Body (VOC 요청 내용) */}
      {voc.body && (
        <div className="mb-3">
          <div className="text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">VOC 요청 내용</div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-slate-800 text-sm leading-relaxed">
            {voc.body}
          </div>
        </div>
      )}

      {/* Request Description */}
      {voc.request_description && (
        <div className="mb-3">
          <div className="text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">요청내용상세</div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-slate-800 text-sm leading-relaxed">
            {voc.request_description}
          </div>
        </div>
      )}

      {/* Response Description */}
      {voc.response_description && (
        <div className="mb-3">
          <div className="text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">대응방안(처리내용상세)</div>
          <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 text-slate-800 text-sm leading-relaxed">
            {voc.response_description}
          </div>
        </div>
      )}

      {/* Info Grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs pt-3 border-t border-slate-200">
        {voc.manager_name && (
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">👔</span>
            <span className="text-slate-600">담당자:</span>
            <span className="font-semibold text-slate-900">{voc.manager_name}</span>
          </div>
        )}
        {voc.requestor_email && (
          <div className="flex items-center gap-1.5 truncate">
            <span className="text-slate-400">👤</span>
            <span className="text-slate-600">요청자 email:</span>
            <span className="font-semibold text-slate-900 truncate">{voc.requestor_email}</span>
          </div>
        )}
        {voc.request_date && (
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">📅</span>
            <span className="text-slate-600">요청일:</span>
            <span className="font-semibold text-slate-900">{voc.request_date}</span>
          </div>
        )}
        {voc.first_response_at && (
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">⚡</span>
            <span className="text-slate-600">최초대응시간:</span>
            <span className="font-semibold text-slate-900">{voc.first_response_at}</span>
          </div>
        )}
        {voc.completed_at && (
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">✓</span>
            <span className="text-slate-600">처리완료일자:</span>
            <span className="font-semibold text-slate-900">{voc.completed_at}</span>
          </div>
        )}
        {voc.sla_hr && (
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">⏱️</span>
            <span className="text-slate-600">SLA:</span>
            <span className="font-semibold text-slate-900">{voc.sla_hr}</span>
          </div>
        )}
        {voc.update_deploy_at && (
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">🚀</span>
            <span className="text-slate-600">수정배포일자:</span>
            <span className="font-semibold text-slate-900">{voc.update_deploy_at}</span>
          </div>
        )}
        {voc.last_dept && (
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">🏢</span>
            <span className="text-slate-600">최종이관부서:</span>
            <span className="font-semibold text-slate-900">{voc.last_dept}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Modal({
  open, onClose, children, title,
}: { open: boolean; onClose: () => void; children: React.ReactNode; title?: string }) {
  // ESC로 닫기 + 바디 스크롤 잠금
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);

    // 배경 스크롤 잠금
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" aria-modal="true" role="dialog">
      {/* dimmed background */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      
      {/* modal card */}
      <div
        className="
          relative w-[92vw] max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200
          z-10 max-h-[85vh] flex flex-col
        "
      >
        {/* header (고정) */}
        <div className="p-6 pb-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">{title || "VOC 상세"}</h2>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
            aria-label="닫기"
          >
            닫기
          </button>
        </div>

        {/* content (스크롤 영역) */}
        <div
          className="
            p-6 pt-4 overflow-y-auto overscroll-contain
          "
        >
          {children}
        </div>
      </div>
    </div>
  );
}


/* ---------------- Main ---------------- */
export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "안녕하세요! 👋\n\n원하시는 작업을 선택하고 메시지를 입력해주세요." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<TaskMode>("QUERY_LIST");
  const endRef = useRef<HTMLDivElement | null>(null);

  // 상세 모달 상태
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<VocDetail | null>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const placeholder =
    mode === "GENERAL"
      ? "예) 아래 문단 영어로 번역해줘 / 이 내용을 3줄로 요약해줘"
      : mode === "QUERY_SIMILAR"
      ? "예) 로그인 인증번호 오류 유사 사례 5건"
      : "예) 어제부터 오늘까지 완료 VOC 50개";

  // 상세 조회 (절대 URL + JSON 파싱)
  const openDetail = async (id: number) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError(null);
    setDetailData(null);
    try {
      const url = `https://sec-dev-ciam-api.cfapps.ap12.hana.ondemand.com/http/restapi/extension/sec/voc-data/${id}`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
      });

      const ctype = res.headers.get("content-type") || "";
      const raw = await res.text(); // 에러 메시지 가독성 위해 먼저 텍스트로
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText} :: ${raw.slice(0, 300)}`);
      }
      if (!/application\/json/i.test(ctype)) {
        throw new Error(`서버가 JSON이 아닌 응답을 보냈습니다. content-type="${ctype}" :: ${raw.slice(0, 160)}`);
      }

      const json = JSON.parse(raw);
      const d = json?.data ?? {};
      const h: VocHistory[] = Array.isArray(json?.history) ? json.history : [];

      const detail: VocDetail = {
        voc_id: d.voc_id,
        old_voc_id: d.old_voc_id,
        title: d.title,
        manager_name: d.manager_name,
        type: d.type,
        request_lv1: d.request_lv1,
        request_lv2: d.request_lv2,
        request_date: d.request_date,
        completed_at: d.completed_at,
        first_response_at: d.first_response_at,
        channel: d.channel,
        last_dept: d.last_dept,
        requestor_email: d.requestor_email,
        requestor_name: d.requestor_name,
        urgency: d.urgency,
        update_deploy_at: d.updated_deploy_at ?? d.update_deploy_at,
        request_description: nl(d.request_description),
        response_description: nl(d.response_description),
        status: (d.status || "").replace("_", " "),
        sla_hr: d.sla_hr,
        created_at: d.created_at,
        updated_at: d.updated_at,
        body: nl(d.body),
        history: h,
      };

      setDetailData(detail);
    } catch (e: any) {
      setDetailError(e.message || "상세 조회 중 오류가 발생했습니다.");
    } finally {
      setDetailLoading(false);
    }
  };
  const closeDetail = () => {
    setDetailOpen(false);
    setDetailData(null);
    setDetailError(null);
  };

  // 채팅 전송
  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    setMessages((prev) => [...prev, { role: "user", content: input }]);

    const text = input;
    setInput("");
    setLoading(true);

    try {
      const prompt = buildPrompt(mode);

      // 프록시 유지: /api/chat
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Task-Mode": mode },
        body: JSON.stringify({
          content: text,  // 사용자가 입력한 자연어
          mode,           // "GENERAL" | "QUERY_LIST" | "QUERY_SIMILAR"
          prompt          // mode에 맞는 시스템 프롬프트
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${res.status} ${res.statusText} :: ${errText}`);
      }

      const ct = res.headers.get("content-type") || "";
      const data = ct.includes("application/json") ? await res.json() : await res.text();

      // GENERAL 응답(OpenAI 스타일 JSON) → 버블 표시
      if (mode === "GENERAL" && typeof data === "object") {
        const content = getOpenAIMessageContent(data);
        setMessages((prev) => [...prev, { role: "assistant", content: content ?? pretty(data) }]);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: data }]);
      }
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: `❌ 오류가 발생했습니다\n\n${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const SegButton = ({
    active,
    onClick,
    children,
    title,
    icon,
  }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
    title: string;
    icon: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={[
        "flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-sm font-bold transition-all duration-300 transform",
        "focus:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300 shadow-md",
        active
          ? "bg-gradient-to-r from-sky-500 via-blue-500 to-cyan-600 text-white scale-105"
          : "bg-white text-slate-700 border-2 border-slate-300 hover:bg-slate-50 hover:border-cyan-400 hover:scale-102"
      ].join(" ")}
    >
      <span className="text-lg">{icon}</span>
      <span>{children}</span>
    </button>
  );

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-gradient-to-br from-sky-100 via-blue-50 to-cyan-100">
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      
      <div className="flex flex-col h-[92vh] w-full max-w-3xl bg-white/80 backdrop-blur-2xl border-2 border-white/60 rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b-2 border-slate-200/60 flex items-center justify-between bg-gradient-to-r from-sky-500 via-blue-500 to-cyan-600 text-white shadow-lg">
          <div className="font-black text-xl tracking-tight flex items-center gap-2">
            <span className="text-2xl">💬</span>
            VOC Chat Console
          </div>
          <div className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white/20 backdrop-blur border border-white/40">
            {mode === "GENERAL" ? "🔄 일반(번역/요약 등)" : mode === "QUERY_SIMILAR" ? "🔍 유사검색" : "📊 정형조회"}
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gradient-to-br from-slate-50 to-cyan-50/30">
          {messages.map((m, i) => {
            // 배열이면 VOC 카드 리스트
            if (m.role === "assistant" && isVocArray(m.content)) {
              return (
                <div key={i} className="flex justify-start animate-[slideIn_0.3s_ease-out]">
                  <div className="max-w-[85%] rounded-3xl px-5 py-4 shadow-lg bg-white/90 border border-slate-200/60 backdrop-blur-xl">
                    <div className="text-xs font-semibold mb-3 text-slate-500">🤖 AI Assistant</div>
                    <div className="space-y-4">
                      {m.content.map((v: VocItem) => (
                        <VocCard key={v.voc_id} voc={v} onClick={() => openDetail(v.voc_id)} />
                      ))}
                    </div>
                  </div>
                </div>
              );
            }
            // 단일 VOC 객체면 카드 하나
            if (m.role === "assistant" && isVocObject(m.content)) {
              return (
                <div key={i} className="flex justify-start animate-[slideIn_0.3s_ease-out]">
                  <div className="max-w-[85%] rounded-3xl px-5 py-4 shadow-lg bg-white/90 border border-slate-200/60 backdrop-blur-xl">
                    <div className="text-xs font-semibold mb-3 text-slate-500">🤖 AI Assistant</div>
                    <VocCard voc={m.content as VocItem} onClick={() => openDetail((m.content as VocItem).voc_id)} />
                  </div>
                </div>
              );
            }
            // 객체 안에 content가 또 들어있는 경우(contentArray가 VOC 배열인지 확인)
            if (m.role === "assistant" && typeof m.content === "object" && m.content !== null && "content" in (m.content as any)) {
              const contentArray = (m.content as any).content;
              if (isVocArray(contentArray)) {
                return (
                  <div key={i} className="flex justify-start animate-[slideIn_0.3s_ease-out]">
                    <div className="max-w-[85%] rounded-3xl px-5 py-4 shadow-lg bg-white/90 border border-slate-200/60 backdrop-blur-xl">
                      <div className="text-xs font-semibold mb-3 text-slate-500">🤖 AI Assistant</div>
                      <div className="space-y-4">
                        {contentArray.map((v: VocItem) => (
                          <VocCard key={v.voc_id} voc={v} onClick={() => openDetail(v.voc_id)} />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              }
            }

            // 문자열(일반 대화/오류/설명) → 버블
            const text = typeof m.content === "string" ? m.content : pretty(m.content);
            return (
              <Bubble key={i} role={m.role}>
                <pre className="whitespace-pre-wrap font-sans">{text}</pre>
              </Bubble>
            );
          })}

          {loading && (
            <div className="flex justify-start animate-[slideIn_0.3s_ease-out]">
              <div className="max-w-[85%] rounded-3xl px-5 py-4 shadow-lg bg-white/90 border border-slate-200/60 text-slate-600 backdrop-blur-xl">
                <div className="flex items-center gap-3">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-blue-600 animate-bounce" style={{animationDelay: '0s'}}></div>
                    <div className="w-2 h-2 rounded-full bg-blue-600 animate-bounce" style={{animationDelay: '0.2s'}}></div>
                    <div className="w-2 h-2 rounded-full bg-blue-600 animate-bounce" style={{animationDelay: '0.4s'}}></div>
                  </div>
                  <span className="font-medium">처리 중입니다...</span>
                </div>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Footer: Mode + Input */}
        <div className="p-5 border-t-2 border-slate-200/60 bg-white/95 backdrop-blur-xl space-y-3">
          {/* Segmented control */}
          <div className="flex flex-wrap gap-2">
            <SegButton 
              active={mode === "GENERAL"} 
              onClick={() => setMode("GENERAL")} 
              title="일반(번역/요약 등)"
              icon="🔄"
            >
              일반(번역/요약 등)
            </SegButton>

            <SegButton 
              active={mode === "QUERY_LIST"} 
              onClick={() => setMode("QUERY_LIST")} 
              title="정형 조회 (SQL)"
              icon="📊"
            >
              정형 조회
            </SegButton>

            <SegButton 
              active={mode === "QUERY_SIMILAR"} 
              onClick={() => setMode("QUERY_SIMILAR")} 
              title="비정형/유사사례 (RAG)"
              icon="🔍"
            >
              유사 검색
            </SegButton>
          </div>

          {/* Input Row */}
          <div className="flex gap-3">
            <input
              className="flex-1 border-2 border-slate-300 rounded-2xl px-5 py-3.5 text-base text-slate-900 placeholder:text-slate-400 bg-white focus:outline-none focus:ring-4 focus:ring-cyan-300 focus:border-cyan-500 transition-all shadow-sm"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder={placeholder}
            />
            <button
              onClick={sendMessage}
              disabled={loading}
              className="px-6 py-3.5 rounded-2xl font-bold text-base text-white bg-gradient-to-r from-sky-500 via-blue-500 to-cyan-600 shadow-lg hover:shadow-xl active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <span>✉️</span>
              <span>보내기</span>
            </button>
          </div>
        </div>
      </div>

      {/* 상세 모달 */}
      <Modal open={detailOpen} onClose={closeDetail} title="VOC 상세">
        {detailLoading && (
          <div className="text-slate-600 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-bounce" />
            <span>불러오는 중입니다…</span>
          </div>
        )}
        {detailError && (
          <div className="text-red-600 font-medium">❌ {detailError}</div>
        )}
        {(!detailLoading && !detailError && detailData) && (
          <div className="space-y-5">
            {/* 상단 요약 */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="text-sm text-slate-500">#{detailData.voc_id} {detailData.old_voc_id && `• ${detailData.old_voc_id}`}</div>
                <div className="text-xl font-bold text-slate-900">{detailData.title || "(제목 없음)"}</div>
                {detailData.requestor_name && (
                  <div className="text-sm text-slate-600 mt-1">요청자: <b>{detailData.requestor_name}</b></div>
                )}
              </div>
              {detailData.status && (
                <span className="px-3 py-1 rounded-full text-xs font-semibold border bg-slate-100 text-slate-700">
                  {detailData.status}
                </span>
              )}
            </div>

           {/* 메타 그리드 */}
<div className="grid grid-cols-2 gap-3 text-sm">
  {detailData.type && (
    <div>
      <span className="text-slate-500">{labelFor("type")}:</span> <b>{detailData.type}</b>
    </div>
  )}
  {detailData.channel && (
    <div>
      <span className="text-slate-500">{labelFor("channel")}:</span> <b>{detailData.channel}</b>
    </div>
  )}
  {detailData.request_lv1 && (
    <div>
      <span className="text-slate-500">{labelFor("request_lv1")}:</span> <b>{detailData.request_lv1}</b>
    </div>
  )}
  {detailData.request_lv2 && (
    <div>
      <span className="text-slate-500">{labelFor("request_lv2")}:</span> <b>{detailData.request_lv2}</b>
    </div>
  )}
  {detailData.manager_name && (
    <div>
      <span className="text-slate-500">{labelFor("manager_name")}:</span> <b>{detailData.manager_name}</b>
    </div>
  )}
  {detailData.request_date && (
    <div>
      <span className="text-slate-500">{labelFor("request_date")}:</span> <b>{detailData.request_date}</b>
    </div>
  )}
  {detailData.first_response_at && (
    <div>
      <span className="text-slate-500">{labelFor("first_response_at")}:</span> <b>{detailData.first_response_at}</b>
    </div>
  )}
  {detailData.completed_at && (
    <div>
      <span className="text-slate-500">{labelFor("completed_at")}:</span> <b>{detailData.completed_at}</b>
    </div>
  )}
  {detailData.update_deploy_at && (
    <div>
      <span className="text-slate-500">{labelFor("update_deploy_at")}:</span> <b>{detailData.update_deploy_at}</b>
    </div>
  )}
  {detailData.last_dept && (
    <div>
      <span className="text-slate-500">{labelFor("last_dept")}:</span> <b>{detailData.last_dept}</b>
    </div>
  )}
  {detailData.sla_hr && (
    <div>
      <span className="text-slate-500">{labelFor("sla_hr")}:</span> <b>{detailData.sla_hr}</b>
    </div>
  )}
  {detailData.created_at && (
    <div>
      <span className="text-slate-500">{labelFor("created_at")}:</span> <b>{detailData.created_at}</b>
    </div>
  )}
  {detailData.updated_at && (
    <div>
      <span className="text-slate-500">{labelFor("updated_at")}:</span> <b>{detailData.updated_at}</b>
    </div>
  )}
</div>


            {/* 본문/요청/응답 상세 */}
            {detailData.request_description && (
              <div>
                <div className="text-xs font-bold text-slate-500 mb-1.5">요청내용상세</div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-slate-800 text-sm leading-relaxed whitespace-pre-wrap">
                  {detailData.request_description}
                </div>
              </div>
            )}
            {detailData.response_description && (
              <div>
                <div className="text-xs font-bold text-slate-500 mb-1.5">대응방안(처리내용상세)</div>
                <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 text-slate-800 text-sm leading-relaxed whitespace-pre-wrap">
                  {detailData.response_description}
                </div>
              </div>
            )}

              {/* 변경 이력 타임라인 */}
              {detailData.history && detailData.history.length > 0 && (
                  <div>
                      <div className="text-xs font-bold text-slate-500 mb-2">변경 이력</div>
                      <div className="space-y-3">
                          {detailData.history.map(h => {
                              const fieldLabel = labelFor(h.field_name);
                              return (
                                  <div key={h.history_id} className="rounded-xl border border-slate-200 p-3 bg-white shadow-sm">
                                      <div className="text-xs text-slate-500 mb-1">{h.updated_date}</div>
                                      <div className="text-sm">
              <span className="font-semibold" title={h.field_name}>
                {fieldLabel}
              </span>
                                          {": "}
                                          <span className="line-through text-slate-400">{h.original_value ?? "∅"}</span>
                                          <span className="mx-2 text-slate-400">→</span>
                                          <span className="font-semibold">{h.updated_value ?? "∅"}</span>
                                      </div>
                                  </div>
                              );
                          })}
                      </div>
                  </div>
              )}
          </div>
        )}
      </Modal>
    </div>
  );
}
