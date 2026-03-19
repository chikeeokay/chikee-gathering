import React, { useEffect, useState, useContext } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  Users,
  Calendar as CalendarIcon,
  Clock,
  Check,
  Share2,
  Copy,
  Package,
  Trash2,
  MessageCircle,
  MapPin,
  Info,
  Target,
  FileText,
  LogIn
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import { SessionWithResponses, Response } from "../types";
import { cn } from "../lib/utils";
import { AdminContext, AuthContext } from "../App";
import { db, auth, signInWithGoogle } from "../firebase";
import { doc, onSnapshot, collection, query, where, addDoc, deleteDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { handleFirestoreError, OperationType } from "../lib/errorHandling";

const isExpired = (dateStr: string) => {
  try {
    const [datePart, timePart] = dateStr.split('T');
    const [start, end] = timePart.split('~');
    const endTimeStr = end ? `${datePart}T${end}:00` : `${datePart}T${start}:00`;
    const endTime = new Date(endTimeStr);
    if (end && start && end < start) {
      endTime.setDate(endTime.getDate() + 1);
    }
    return endTime < new Date();
  } catch (e) {
    return false;
  }
};

const formatPreference = (pref: string) => {
  if (pref === 'Any') return '不限人數';
  if (pref === '5+') return '5 人以上';
  return `${pref} 人`;
};

export default function SessionDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionWithResponses | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [deleteSessionError, setDeleteSessionError] = useState("");

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const { user } = useContext(AuthContext);

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      await signInWithGoogle();
    } catch (error: any) {
      if (error.code === 'auth/popup-blocked') {
        alert("登入視窗被瀏覽器封鎖了，請允許彈出視窗後再試一次。");
      } else if (error.code === 'auth/cancelled-popup-request') {
        // Ignore
      } else {
        console.error("Login error:", error);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };
  const isAdmin = useContext(AdminContext);

  // Response form state
  const [playerName, setPlayerName] = useState("");
  const [bookingCode, setBookingCode] = useState("");
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [copied, setCopied] = useState(false);

  // Delete Response Modal State
  const [responseToDelete, setResponseToDelete] = useState<{ id: string, name: string } | null>(null);
  const [isDeletingResponse, setIsDeletingResponse] = useState(false);
  const [deleteResponseError, setDeleteResponseError] = useState("");

  useEffect(() => {
    if (!id) return;

    const unsubscribeSession = onSnapshot(doc(db, "sessions", id), (docSnap) => {
      if (docSnap.exists()) {
        const sessionData = { id: docSnap.id, ...docSnap.data() } as any;
        
        // Add fallbacks for older sessions
        sessionData.min_players = sessionData.min_players || parseInt(sessionData.player_count_preference?.split('-')[0]) || 3;
        sessionData.max_players = sessionData.max_players || parseInt(sessionData.player_count_preference?.split('-')[1]) || 4;

        // Filter out expired dates
        const validDates = sessionData.dates_available.filter((date: string) => !isExpired(date));
        
        // Cleanup if needed
        if (validDates.length < sessionData.dates_available.length) {
          if (auth.currentUser && (sessionData.host_uid === auth.currentUser.uid || isAdmin)) {
            if (validDates.length === 0) {
              deleteDoc(doc(db, "sessions", docSnap.id)).catch(console.error);
            } else {
              updateDoc(doc(db, "sessions", docSnap.id), { dates_available: validDates }).catch(console.error);
            }
          }
        }

        sessionData.dates_available = validDates;

        // If all dates are expired, we might still want to show it briefly before it's deleted,
        // or just show an error. Let's just let it render with 0 dates for now.

        // Fetch responses
        const q = query(collection(db, "responses"), where("session_id", "==", id));
        const unsubscribeResponses = onSnapshot(q, (responsesSnap) => {
          const responses: Response[] = [];
          responsesSnap.forEach((rDoc) => {
            responses.push({ id: rDoc.id, ...rDoc.data() } as Response);
          });
          
          // Sort responses by created_at to ensure waiting list priority is correct
          responses.sort((a, b) => {
            const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
            const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
            return dateA - dateB;
          });
          
          setSession({ ...sessionData, responses });
          setLoading(false);
        }, (err) => {
          setLoading(false);
          handleFirestoreError(err, OperationType.GET, "responses");
        });

        return () => unsubscribeResponses();
      } else {
        setError("找不到該約局。");
        setLoading(false);
      }
    }, (err) => {
      setLoading(false);
      handleFirestoreError(err, OperationType.GET, `sessions/${id}`);
    });

    return () => unsubscribeSession();
  }, [id]);

  const toggleDateSelection = (date: string) => {
    const newSelection = new Set(selectedDates);
    if (newSelection.has(date)) {
      newSelection.delete(date);
    } else {
      newSelection.add(date);
    }
    setSelectedDates(newSelection);
  };

  const handleSubmitResponse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName) {
      alert("請輸入你的名字。");
      return;
    }
    if (!bookingCode) {
      alert("請輸入報名驗證碼 (Booking Code)。");
      return;
    }
    if (selectedDates.size === 0) {
      alert("請至少選擇一個你可以參加的日期。");
      return;
    }
    if (session?.booking_code && bookingCode.trim().toUpperCase() !== session.booking_code) {
      setSubmitError("報名驗證碼錯誤。");
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    // Use user.uid if logged in, otherwise use a persistent anonymous ID from localStorage
    let participant_uid = user?.uid;
    if (!participant_uid) {
      participant_uid = localStorage.getItem('anon_participant_id') || "";
      if (!participant_uid) {
        participant_uid = `anon_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        localStorage.setItem('anon_participant_id', participant_uid);
      }
    }

    // Check for overlapping dates for THIS NAME across all user's previous responses in this session
    const namePreviousDates = new Set<string>();
    session?.responses.forEach(r => {
      if (r.participant_uid === participant_uid && r.player_name.trim() === playerName.trim()) {
        r.dates_available.forEach(d => namePreviousDates.add(d));
      }
    });

    const overlappingDates = Array.from(selectedDates).filter(d => namePreviousDates.has(d));
    if (overlappingDates.length > 0) {
      const formattedOverlap = overlappingDates.map(d => format(parseISO(d.split('~')[0]), "M月d日")).join(", ");
      setSubmitError(`你已用名字「${playerName}」報名過以下時段：${formattedOverlap}，請取消勾選後再送出。`);
      setIsSubmitting(false);
      return;
    }

    try {
      const responseData = {
        session_id: id,
        participant_uid: participant_uid,
        player_name: playerName,
        dates_available: Array.from(selectedDates),
        created_at: new Date().toISOString()
      };
      console.log("Submitting response:", responseData);
      
      await addDoc(collection(db, "responses"), responseData);

      // Reset form
      setBookingCode("");
      setSelectedDates(new Set());
    } catch (err: any) {
      console.error("Join error:", err);
      const errorMessage = err.message || String(err);
      if (errorMessage.toLowerCase().includes("permission") || errorMessage.toLowerCase().includes("insufficient")) {
        setSubmitError("權限不足：請確保你已輸入正確的資料。如果問題持續，請聯絡管理員。");
      } else {
        setSubmitError(errorMessage || "送出回覆失敗，請再試一次。");
      }
      // Log full error info for diagnostics
      try {
        handleFirestoreError(err, OperationType.CREATE, "responses");
      } catch (e) {
        // Already logged by handleFirestoreError
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyLink = () => {
    let shareUrl = window.location.href;
    // If the host copies the link from their private developer preview, 
    // automatically convert it to the public shared URL so friends don't get a 403 error.
    if (shareUrl.includes('ais-dev-')) {
      shareUrl = shareUrl.replace('ais-dev-', 'ais-pre-');
    }
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.uid !== session?.host_uid) return;

    setIsDeletingSession(true);
    setDeleteSessionError("");

    try {
      await deleteDoc(doc(db, "sessions", id!));
      // Also delete all responses for this session
      // For simplicity, we'll let the user delete the session and the responses will be orphaned,
      // or we can delete them. We'll just delete the session for now.
      navigate('/');
    } catch (err: any) {
      console.error(err);
      setDeleteSessionError(err.message || "刪除失敗。");
    } finally {
      setIsDeletingSession(false);
    }
  };

  const handleDeleteResponse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!responseToDelete || !user) return;

    setIsDeletingResponse(true);
    setDeleteResponseError("");

    try {
      await deleteDoc(doc(db, "responses", responseToDelete.id));
      setResponseToDelete(null);
    } catch (err: any) {
      console.error(err);
      setDeleteResponseError(err.message || "刪除失敗。");
    } finally {
      setIsDeletingResponse(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-stone-900 mb-4">哎呀！</h2>
        <p className="text-stone-600 mb-6">{error || "找不到該約局。"}</p>
        <Link to="/" className="text-orange-600 font-medium hover:underline">
          返回首頁
        </Link>
      </div>
    );
  }

  // Calculate availability counts for each date
  const availabilityCounts = session.dates_available.reduce(
    (acc, date) => {
      acc[date] = session.responses.filter((r) =>
        r.dates_available.includes(date),
      ).length;
      return acc;
    },
    {} as Record<string, number>,
  );

  const maxAvailability = Math.max(
    ...(Object.values(availabilityCounts) as number[]),
    0,
  );
  const totalPlayers = session.responses.length + 1; // +1 for the host (assuming host is available on all proposed dates)

  return (
    <div className="max-w-4xl mx-auto space-y-3 pb-8">
      {/* Host Info Card */}
      {user && user.uid === session.host_uid && (
        <div className="brutal-card p-3 sm:p-4 bg-amber-100 border-4 border-black rounded-[24px]">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h2 className="text-lg sm:text-xl font-black text-stone-900 flex items-center gap-2">
                <span className="text-2xl">👑</span> 你是這個約局的主持人
              </h2>
              <p className="text-stone-700 font-bold text-sm mt-1">
                請將下方的驗證碼提供給想報名的參加者。
              </p>
            </div>
            <div className="bg-white px-4 py-2 rounded-xl border-2 border-black shadow-[4px_4px_0_0_rgba(0,0,0,1)] text-center w-full sm:w-auto">
              <div className="text-xs font-black text-stone-500 mb-1">BOOKING CODE</div>
              <div className="text-2xl sm:text-3xl font-black tracking-widest text-orange-600">
                {session.booking_code}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header Card */}
      <div className="brutal-card p-1 sm:p-1.5 bg-white rounded-[24px]">
        <div className="flex flex-row justify-between items-center gap-2 mb-0.5">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-4xl font-black text-stone-900 leading-none drop-shadow-[2px_2px_0_rgba(251,191,36,1)] truncate">
              {session.game_name}
            </h1>
            <p className="text-stone-700 font-bold text-base sm:text-lg leading-none mt-0.5 truncate">
              HOST-主持：{session.host_name}
            </p>
          </div>
          {session.host_whatsapp && (
            <div className="shrink-0">
              <a
                href={`https://wa.me/${session.host_whatsapp.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 px-1.5 py-1 bg-orange-400 hover:bg-orange-500 text-black text-xs sm:text-base font-bold border-2 border-black rounded-xl shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-transform hover:-translate-y-0.5 hover:shadow-[3px_3px_0_0_rgba(0,0,0,1)] whitespace-nowrap"
              >
                <MessageCircle className="w-3 h-3 sm:w-5 sm:h-5 shrink-0" />
                <span>一鍵PM HOST獲取資訊</span>
              </a>
            </div>
          )}
        </div>

        <hr className="border-t-4 border-black my-1.5" />

        <div className="flex flex-col items-start gap-1">
          {session.game_source !== "N/A" && session.game_source && (
            <div className="flex items-center gap-1 text-stone-800 bg-white border-2 border-black px-1.5 py-0.5 rounded-xl text-sm font-bold shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
              <Package className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              {session.game_source}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1">
            {session.location && (
              <div className="flex items-center gap-1 text-stone-800 bg-white border-2 border-black px-1.5 py-0.5 rounded-xl text-sm font-bold shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
                <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                {session.location}
              </div>
            )}
            <div className="flex items-center gap-1 text-stone-800 bg-white border-2 border-black px-1.5 py-0.5 rounded-xl text-sm font-bold shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
              <Users className="w-3.5 h-3.5 text-orange-500 shrink-0" />
              理想人數：{formatPreference(session.player_count_preference)}
            </div>
          </div>
          {session.rules && (
            <div className="flex items-center gap-1 text-stone-800 bg-white border-2 border-black px-1.5 py-0.5 rounded-xl text-sm font-bold shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
              <Info className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              {session.rules}
            </div>
          )}
          {session.purpose && (
            <div className="flex items-center gap-1 text-stone-800 bg-white border-2 border-black px-1.5 py-0.5 rounded-xl text-sm font-bold shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
              <Target className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              {session.purpose}
            </div>
          )}
          {session.content && (
            <div className="flex items-center gap-1 text-stone-800 bg-white border-2 border-black px-1.5 py-0.5 rounded-xl text-sm font-bold shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
              <FileText className="w-3.5 h-3.5 text-orange-500 shrink-0" />
              {session.content}
            </div>
          )}
          <div className="flex items-center gap-1 text-stone-800 bg-white border-2 border-black px-1.5 py-0.5 rounded-xl text-sm font-bold shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
            <Clock className="w-3.5 h-3.5 text-teal-500 shrink-0" />
            建立於 {format(parseISO(session.created_at), "yyyy年M月d日")}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        {/* Availability Grid */}
        <div className="md:col-span-2 space-y-6">
          <h2 className="text-xl font-black text-stone-900 inline-block border-b-4 border-orange-400">能成團的時間</h2>

          {/* Mobile View: Card Grid */}
          <div className="grid grid-cols-2 gap-2 md:hidden">
            {session.dates_available.map((date) => {
              const count = availabilityCounts[date] + 1;
              const isBest = count >= session.min_players && count <= session.max_players;
              const isOver = count > session.max_players;
              const [startStr, endStr] = date.split('~');

              return (
                <div key={date} className="brutal-card flex flex-col overflow-hidden p-0">
                  {/* Header */}
                  <div className="bg-orange-100 border-b-4 border-black p-0.5 text-center">
                    <div className="font-black text-lg leading-tight">{format(parseISO(startStr), "M月d日", { locale: zhTW })}</div>
                    <div className="text-stone-700 font-bold text-base leading-tight">
                      {format(parseISO(startStr), "HHmm")}
                      {endStr ? `-${endStr.replace(':', '')}` : ''}
                    </div>
                  </div>
                  
                  {/* Players */}
                  <div className="flex-1 p-1 space-y-0.5 bg-white">
                    {/* Host */}
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-base font-bold truncate">{session.host_name}</span>
                        <span className="text-[10px] bg-rose-400 text-black border border-black px-1 rounded-sm whitespace-nowrap">HOST</span>
                      </div>
                      <div className="w-5 h-5 rounded-md bg-orange-400 border-2 border-black flex items-center justify-center shrink-0">
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                    </div>
                    {/* Responses */}
                    {session.responses.map((response, responseIndex) => {
                      const isAvailable = response.dates_available.includes(date);
                      if (!isAvailable) return null;
                      let peopleBefore = 1;
                      for (let i = 0; i < responseIndex; i++) {
                        if (session.responses[i].dates_available.includes(date)) {
                          peopleBefore++;
                        }
                      }
                      const isWaiting = isAvailable && peopleBefore >= session.max_players;

                      return (
                        <div key={response.id} className="flex justify-between items-center group">
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="text-base font-bold text-stone-700 truncate">{response.player_name}</span>
                          {( (user?.uid && user.uid === session.host_uid) || isAdmin ) && (
                            <button
                              onClick={() => setResponseToDelete({ id: response.id, name: response.player_name })}
                              className="text-rose-500 hover:text-rose-700 transition-colors p-1 hover:bg-rose-100 rounded-lg border-2 border-transparent hover:border-rose-200 shrink-0"
                              title="刪除參加者"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          </div>
                          <div className={cn(
                            "w-5 h-5 rounded-md border-2 border-black flex items-center justify-center shrink-0 relative",
                            isWaiting ? "bg-amber-300" : "bg-orange-400"
                          )}>
                            <Check className="w-3 h-3 stroke-[3]" />
                            {isWaiting && (
                              <span className="absolute -bottom-1 -right-1 bg-white text-[6px] font-black px-0.5 border border-black rounded">
                                W
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer */}
                  <div className="bg-sky-100 border-t-4 border-black p-1 flex flex-col items-center justify-center gap-0">
                    <div className="flex items-center justify-center gap-1">
                      <span className={cn(
                        "font-black text-2xl",
                        isBest ? "text-rose-600" : isOver ? "text-amber-600" : "text-stone-900"
                      )}>
                        {isOver ? session.max_players : count}人
                      </span>
                      <span className={cn(
                        "text-base font-bold",
                        count >= session.min_players ? "text-rose-600" : "text-stone-600"
                      )}>
                        {count >= session.max_players
                          ? "(滿團)"
                          : count >= session.min_players 
                          ? `(可加${session.max_players - count})` 
                          : `(欠${session.min_players - count}人)`}
                      </span>
                    </div>
                    {count < session.min_players && (
                      <span className="text-xs font-bold text-stone-600 leading-none">
                        (尚欠 {session.min_players - count} 人成團)
                      </span>
                    )}
                    {isOver && (
                      <span className="text-xs font-bold text-amber-600 leading-none">
                        ({count - session.max_players}人 waiting list)
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop View: Table */}
          <div className="brutal-card overflow-hidden hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-max">
                <thead>
                  <tr className="bg-orange-100 border-b-4 border-black">
                    <th className="p-1 sm:p-1.5 font-black text-stone-900 text-sm sm:text-base min-w-[80px] sm:min-w-[150px] border-r-4 border-black">
                      玩家
                    </th>
                    {session.dates_available.map((date) => {
                      const [startStr, endStr] = date.split('~');
                      return (
                      <th
                        key={date}
                        className="p-1 sm:p-1.5 font-black text-stone-900 text-xs sm:text-sm min-w-[70px] sm:min-w-[120px] border-r-4 border-black last:border-r-0"
                      >
                        <div className="flex flex-col items-center sm:items-start">
                          <span className="whitespace-nowrap">{format(parseISO(startStr), "M月d日", { locale: zhTW })}</span>
                          <span className="text-stone-700 font-bold whitespace-nowrap">
                            {format(parseISO(startStr), "HHmm")}
                            {endStr ? `-${endStr.replace(':', '')}` : ''}
                          </span>
                        </div>
                      </th>
                    )})}
                  </tr>
                </thead>
                <tbody className="divide-y-4 divide-black">
                  {/* Host Row */}
                  <tr className="hover:bg-amber-50 transition-colors">
                    <td className="p-1 sm:p-1.5 font-black text-stone-900 border-r-4 border-black">
                      <div className="flex flex-row flex-wrap items-center gap-1 sm:gap-1.5">
                        <span className="text-sm sm:text-base">{session.host_name}</span>
                        <div className="flex flex-row flex-wrap items-center gap-1">
                          <span className="text-[9px] sm:text-xs bg-rose-400 text-black border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] px-1 sm:px-2 py-0.5 rounded-md whitespace-nowrap">
                            HOST
                          </span>
                          {session.host_whatsapp && (
                            <a
                              href={`https://wa.me/${session.host_whatsapp.replace(/\D/g, '')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center gap-1 bg-green-400 text-black border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] px-1 sm:px-2 py-0.5 rounded-md hover:-translate-y-0.5 hover:shadow-[3px_3px_0_0_rgba(0,0,0,1)] transition-all text-[9px] sm:text-xs font-black whitespace-nowrap"
                              title="WhatsApp Host"
                            >
                              <MessageCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                              PM
                            </a>
                          )}
                        </div>
                      </div>
                    </td>
                    {session.dates_available.map((date) => (
                      <td key={date} className="p-1 sm:p-1.5 text-center border-r-4 border-black last:border-r-0">
                        <div className="inline-flex justify-center items-center w-6 h-6 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-orange-400 border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] text-black">
                          <Check className="w-4 h-4 sm:w-6 sm:h-6 stroke-[3]" />
                        </div>
                      </td>
                    ))}
                  </tr>

                  {/* Responses Rows */}
                  {session.responses.map((response, responseIndex) => (
                    <tr
                      key={response.id}
                      className="hover:bg-sky-50 transition-colors group"
                    >
                      <td className="p-1 sm:p-1.5 text-stone-800 font-bold text-sm sm:text-base border-r-4 border-black relative">
                        <div className="flex items-center justify-between">
                          <span>{response.player_name}</span>
                          {( (user?.uid && user.uid === session.host_uid) || isAdmin ) && (
                            <button
                              onClick={() => setResponseToDelete({ id: response.id, name: response.player_name })}
                              className="text-rose-500 hover:text-rose-700 transition-colors p-1.5 hover:bg-rose-100 rounded-xl border-2 border-transparent hover:border-rose-200"
                              title="刪除參加者"
                            >
                              <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                            </button>
                          )}
                        </div>
                      </td>
                      {session.dates_available.map((date) => {
                        const isAvailable = response.dates_available.includes(date);
                        let peopleBefore = 1; // Host
                        for (let i = 0; i < responseIndex; i++) {
                          if (session.responses[i].dates_available.includes(date)) {
                            peopleBefore++;
                          }
                        }
                        const isWaiting = isAvailable && peopleBefore >= session.max_players;

                        return (
                        <td key={date} className="p-1 sm:p-1.5 text-center border-r-4 border-black last:border-r-0">
                          {isAvailable ? (
                            <div className={cn(
                              "inline-flex justify-center items-center w-6 h-6 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] text-black relative",
                              isWaiting ? "bg-amber-300" : "bg-orange-400"
                            )}>
                              <Check className="w-4 h-4 sm:w-6 sm:h-6 stroke-[3]" />
                              {isWaiting && (
                                <span className="absolute -bottom-2 -right-2 bg-white text-[8px] sm:text-[10px] font-black px-1 border-2 border-black rounded shadow-[1px_1px_0_0_rgba(0,0,0,1)] whitespace-nowrap scale-75 sm:scale-100 origin-top-left">
                                  waiting list
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="inline-flex justify-center items-center w-6 h-6 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-stone-200 border-2 border-stone-400 text-stone-500">
                              -
                            </div>
                          )}
                        </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-sky-100 border-t-4 border-black">
                  <tr>
                    <td className="p-1 sm:p-1.5 font-black text-stone-900 text-xs sm:text-base border-r-4 border-black">
                      已報名
                    </td>
                    {session.dates_available.map((date) => {
                      // +1 for host
                      const count = availabilityCounts[date] + 1;
                      const isBest = count >= session.min_players && count <= session.max_players;
                      const isOver = count > session.max_players;

                      return (
                        <td key={date} className="p-1 sm:p-1.5 text-center border-r-4 border-black last:border-r-0">
                          <div className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1">
                            <span
                              className={cn(
                                "font-black text-lg sm:text-2xl",
                                count >= session.min_players ? "text-rose-600" : "text-stone-900",
                              )}
                            >
                              {isOver ? session.max_players : count}人
                            </span>
                            <span className={cn(
                              "text-[10px] sm:text-sm font-bold",
                              count >= session.min_players ? "text-rose-600" : "text-stone-600"
                            )}>
                              {count >= session.max_players
                                ? "(滿團)"
                                : count >= session.min_players 
                                ? `(可加${session.max_players - count}人)` 
                                : `(欠${session.min_players - count}人)`}
                            </span>
                          </div>
                          {isOver && (
                            <div className="text-[9px] sm:text-xs font-black mt-1 bg-amber-300 text-black inline-block px-1 sm:px-2 py-0.5 border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
                              ({count - session.max_players}人 waiting list)
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Action Buttons Section - Moved here under the table */}
          <div className="flex flex-col gap-4 mt-6">
            {/* Host Management Section */}
            {user?.uid === session.host_uid && session.responses.length > 0 && (
              <div className="brutal-card p-4 sm:p-5 bg-rose-50 border-4 border-black rounded-[24px]">
                <h3 className="text-lg sm:text-xl font-black text-stone-900 mb-3 flex items-center gap-2">
                  <Trash2 className="w-5 h-5 text-rose-600" />
                  管理所有參加者 (Host Only)
                </h3>
                <div className="grid grid-cols-1 gap-2">
                  {session.responses.map((r) => (
                    <div key={r.id} className="flex items-center justify-between p-2 bg-white border-4 border-black rounded-xl shadow-[3px_3px_0_0_rgba(0,0,0,1)]">
                      <span className="font-black text-base">{r.player_name}</span>
                      <button
                        onClick={() => setResponseToDelete({ id: r.id, name: r.player_name })}
                        className="brutal-btn bg-rose-500 hover:bg-rose-600 text-white px-3 py-1 text-xs"
                      >
                        移除此人
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3">
              {/* Hint for cancellation */}
              <div className="brutal-card p-3 bg-amber-100 border-4 border-black rounded-2xl shadow-[4px_4px_0_0_rgba(0,0,0,1)] flex items-center justify-center gap-2">
                <Info className="w-5 h-5 text-amber-600 shrink-0" />
                <span className="text-sm sm:text-base font-black text-stone-900">
                  💡 如要取消報名，請自行 PM HOST 主持
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                {user?.uid === session.host_uid && (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-stone-900 hover:bg-black text-white text-base font-black border-4 border-black rounded-2xl shadow-[4px_4px_0_0_rgba(0,0,0,1)] transition-transform hover:-translate-y-1 hover:shadow-[6px_6px_0_0_rgba(0,0,0,1)]"
                  >
                    <Trash2 className="w-5 h-5" />
                    <span>刪除整個約局 (Delete Session)</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Add Response Form */}
        <div className="md:col-span-1">
          <div className="brutal-card p-2 sm:p-2.5 sticky top-24 bg-white">
            <h3 className="text-xl sm:text-2xl font-black text-stone-900 mb-2 drop-shadow-[2px_2px_0_rgba(251,191,36,1)]">
              報名表
            </h3>

            {(() => {
              const currentUid = user?.uid || localStorage.getItem('anon_participant_id');
              const hasAnyRegistration = currentUid && session.responses.some(r => r.participant_uid === currentUid);
              const hasRegistrationWithName = currentUid && playerName.trim() && session.responses.some(r => 
                r.participant_uid === currentUid && r.player_name.trim() === playerName.trim()
              );

              if (hasRegistrationWithName) {
                return (
                  <div className="bg-blue-50 border-2 border-blue-200 p-2 rounded-xl text-xs font-bold text-blue-700 mb-2">
                    💡 你已用名字「{playerName}」報名過，可以繼續報名其他時段。
                  </div>
                );
              } else if (hasAnyRegistration) {
                return (
                  <div className="bg-green-50 border-2 border-green-200 p-2 rounded-xl text-xs font-bold text-green-700 mb-2">
                    💡 你已報名過。如要幫朋友報名，請輸入朋友的名字。
                  </div>
                );
              }
              return null;
            })()}

            <form onSubmit={handleSubmitResponse} className="space-y-2">
              <div>
                <label
                  htmlFor="playerName"
                  className="block text-sm sm:text-base font-bold text-stone-900 mb-0.5"
                >
                  你的名字
                </label>
                <input
                  type="text"
                  id="playerName"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm sm:text-base border-4 border-black rounded-2xl focus:outline-none focus:ring-4 focus:ring-orange-400/50 transition-all"
                  placeholder="例如：小池"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="bookingCode"
                  className="block text-sm sm:text-base font-bold text-stone-900 mb-0.5"
                >
                  報名驗證碼 (Booking Code)
                </label>
                <div className="flex flex-col gap-1">
                  <input
                    type="text"
                    id="bookingCode"
                    value={bookingCode}
                    onChange={(e) => setBookingCode(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm sm:text-base border-4 border-black rounded-2xl focus:outline-none focus:ring-4 focus:ring-orange-400/50 transition-all"
                    placeholder="請向 Host 索取 4 位數字驗證碼"
                    maxLength={4}
                    pattern="\d{4}"
                    title="請輸入 4 位數字驗證碼"
                    required
                  />
                  {session.host_whatsapp && (
                    <a
                      href={`https://wa.me/${session.host_whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`你好，我想報名參加「${session.game_name}」約局，請問可以給我報名驗證碼嗎？`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs sm:text-sm font-bold text-teal-600 hover:text-teal-700 flex items-center gap-1"
                    >
                      <MessageCircle className="w-3 h-3 sm:w-4 sm:h-4" />
                      按此 WhatsApp Host 索取驗證碼
                    </a>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm sm:text-base font-bold text-stone-900 mb-1">
                  選擇你可以參加的日期
                </label>
                <div className="space-y-1.5">
                  {session.dates_available.map((date) => {
                    const isFull = availabilityCounts[date] + 1 >= session.max_players;
                    const currentUid = user?.uid || localStorage.getItem('anon_participant_id');
                    const isAlreadyRegisteredByThisName = session.responses.some(r => 
                      r.participant_uid === currentUid && 
                      r.player_name.trim() === playerName.trim() && 
                      r.dates_available.includes(date)
                    );
                    const [startStr, endStr] = date.split('~');
                    
                    return (
                    <label
                      key={date}
                      className={cn(
                        "flex items-center p-2.5 border-4 rounded-2xl transition-all",
                        isAlreadyRegisteredByThisName 
                          ? "opacity-60 bg-stone-100 border-stone-300 cursor-not-allowed"
                          : selectedDates.has(date)
                            ? "border-black bg-orange-300 shadow-[4px_4px_0_0_rgba(0,0,0,1)] -translate-y-0.5 cursor-pointer"
                            : "border-black bg-white hover:bg-stone-50 hover:shadow-[4px_4px_0_0_rgba(0,0,0,1)] hover:-translate-y-0.5 cursor-pointer",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={selectedDates.has(date)}
                        onChange={() => !isAlreadyRegisteredByThisName && toggleDateSelection(date)}
                        disabled={isAlreadyRegisteredByThisName}
                      />
                      <div
                        className={cn(
                          "w-6 h-6 rounded-md border-2 flex items-center justify-center mr-3 transition-colors shrink-0",
                          isAlreadyRegisteredByThisName
                            ? "bg-stone-300 border-stone-400"
                            : selectedDates.has(date)
                              ? "bg-black border-black"
                              : "border-black bg-white",
                        )}
                      >
                        {selectedDates.has(date) && (
                          <Check className="w-4 h-4 text-white stroke-[3]" />
                        )}
                        {isAlreadyRegisteredByThisName && (
                          <Check className="w-4 h-4 text-stone-500 stroke-[3]" />
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span
                          className={cn(
                            "text-base font-black leading-tight",
                            isAlreadyRegisteredByThisName ? "text-stone-400" : selectedDates.has(date) ? "text-black" : "text-stone-900",
                          )}
                        >
                          {format(parseISO(startStr), "M月d日", { locale: zhTW })}
                          {isAlreadyRegisteredByThisName && (
                            <span className="ml-2 text-[10px] bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded border-2 border-stone-300 align-middle">
                              你已報名此時段
                            </span>
                          )}
                          {!isAlreadyRegisteredByThisName && isFull && (
                            <span className="ml-2 text-[10px] bg-amber-300 text-black px-1.5 py-0.5 rounded border-2 border-black shadow-[1px_1px_0_0_rgba(0,0,0,1)] align-middle">
                              waiting list
                            </span>
                          )}
                        </span>
                        <span
                          className={cn(
                            "text-sm font-bold",
                            isAlreadyRegisteredByThisName ? "text-stone-400" : selectedDates.has(date) ? "text-black/80" : "text-stone-500",
                          )}
                        >
                          {format(parseISO(startStr), "HHmm")}
                          {endStr ? `-${endStr.replace(':', '')}` : ''}
                        </span>
                      </div>
                    </label>
                  )})}
                </div>
              </div>

              {submitError && (
                <div className="bg-rose-100 border-4 border-rose-500 text-rose-700 p-3 rounded-2xl text-sm font-bold shadow-[4px_4px_0_0_rgba(244,63,94,1)]">
                  {submitError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || !playerName || selectedDates.size === 0}
                className={cn(
                  "w-full px-3 py-2.5 text-xl font-bold rounded-2xl transition-all",
                  isSubmitting || !playerName || selectedDates.size === 0
                    ? "bg-stone-500 text-white cursor-not-allowed"
                    : "bg-black text-white hover:bg-rose-500 hover:text-black border-4 border-black shadow-[4px_4px_0_0_rgba(0,0,0,1)] hover:-translate-y-1 hover:shadow-[6px_6px_0_0_rgba(0,0,0,1)]"
                )}
              >
                {isSubmitting ? "送出中..." : "送出時間"}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-stone-900/50 flex items-center justify-center z-[100] px-4 backdrop-blur-sm">
          <div className="brutal-card p-6 w-full max-w-sm bg-white">
            <h3 className="text-2xl font-black text-stone-900 mb-2">確定要刪除嗎？</h3>
            <p className="text-stone-700 font-bold mb-4">這個動作無法復原，所有相關的回覆也會一併刪除。</p>
            
            <form onSubmit={handleDelete} className="space-y-4">
              {deleteSessionError && (
                <p className="text-rose-600 font-bold text-sm bg-rose-100 p-2 rounded-lg border-2 border-rose-500">{deleteSessionError}</p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button 
                  type="button" 
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteSessionError("");
                  }} 
                  className="px-4 py-2 font-bold text-stone-600 hover:text-stone-900 transition-colors"
                >
                  取消
                </button>
                <button 
                  type="submit" 
                  disabled={isDeletingSession}
                  className="brutal-btn bg-rose-500 hover:bg-rose-600 text-white px-4 py-2"
                >
                  {isDeletingSession ? "刪除中..." : "確定刪除"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Response Modal */}
      {responseToDelete && (
        <div className="fixed inset-0 bg-stone-900/50 flex items-center justify-center z-[100] px-4 backdrop-blur-sm">
          <div className="brutal-card p-6 w-full max-w-sm bg-white">
            <h3 className="text-2xl font-black text-stone-900 mb-2">刪除參加者</h3>
            <p className="text-stone-700 font-bold mb-4">
              確定要刪除 <span className="text-rose-600">"{responseToDelete.name}"</span> 的報名嗎？
            </p>
            
            <form onSubmit={handleDeleteResponse} className="space-y-4">
              {deleteResponseError && (
                <p className="text-rose-600 font-bold text-sm bg-rose-100 p-2 rounded-lg border-2 border-rose-500">{deleteResponseError}</p>
              )}

              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setResponseToDelete(null);
                    setDeleteResponseError("");
                  }}
                  className="px-4 py-2 font-bold text-stone-600 hover:text-stone-900 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isDeletingResponse}
                  className="brutal-btn bg-rose-500 hover:bg-rose-600 text-white px-4 py-2"
                >
                  {isDeletingResponse ? "刪除中..." : "確定刪除"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
