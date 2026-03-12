import React, { useEffect, useState, useContext } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Users, Calendar, Clock, ChevronRight, Package, Trash2, MapPin, Info, Target, FileText, MessageCircle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Session, Response } from "../types";
import { AdminContext } from "../App";
import { db, auth } from "../firebase";
import { collection, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc } from "firebase/firestore";
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

export default function HomePage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [responses, setResponses] = useState<Response[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "boardgame" | "mahjong" | "social">("all");
  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const navigate = useNavigate();

  useEffect(() => {
    const q = query(collection(db, "sessions"), orderBy("created_at", "desc"));
    const unsubscribeSessions = onSnapshot(q, (snapshot) => {
      const sessionData: Session[] = [];
      snapshot.forEach((doc) => {
        sessionData.push({ id: doc.id, ...doc.data() } as Session);
      });
      setSessions(sessionData);
      setLoading(false);
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.GET, "sessions");
    });

    const unsubscribeResponses = onSnapshot(collection(db, "responses"), (snapshot) => {
      const responseData: Response[] = [];
      snapshot.forEach((doc) => {
        responseData.push({ id: doc.id, ...doc.data() } as Response);
      });
      
      // Sort responses by created_at for consistency
      responseData.sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateA - dateB;
      });
      
      setResponses(responseData);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "responses");
    });

    return () => {
      unsubscribeSessions();
      unsubscribeResponses();
    };
  }, []);

  const isAdmin = useContext(AdminContext);

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSessionToDelete(id);
  };

  const confirmDelete = async () => {
    if (!sessionToDelete) return;
    try {
      await deleteDoc(doc(db, "sessions", sessionToDelete));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `sessions/${sessionToDelete}`);
    } finally {
      setSessionToDelete(null);
    }
  };

  useEffect(() => {
    if (loading) return;

    sessions.forEach(async (session) => {
      const validDates = session.dates_available.filter(date => !isExpired(date));
      
      if (validDates.length < session.dates_available.length) {
        // Only host or admin can update/delete
        if (auth.currentUser && (session.host_uid === auth.currentUser.uid || isAdmin)) {
          try {
            if (validDates.length === 0) {
              await deleteDoc(doc(db, "sessions", session.id));
            } else {
              await updateDoc(doc(db, "sessions", session.id), {
                dates_available: validDates
              });
            }
          } catch (e) {
            console.error("Failed to cleanup expired session", e);
          }
        }
      }
    });
  }, [sessions, loading, isAdmin]);

  const activeSessions = sessions.map(session => ({
    ...session,
    dates_available: session.dates_available.filter(date => !isExpired(date))
  })).filter(session => session.dates_available.length > 0);

  const sessionsWithCounts = activeSessions.map(session => {
    const sessionResponses = responses.filter(r => r.session_id === session.id);
    
    const availabilityCounts = session.dates_available.reduce((acc, date) => {
      acc[date] = sessionResponses.filter(r => r.dates_available.includes(date)).length;
      return acc;
    }, {} as Record<string, number>);

    let maxCount = 0;
    let bestDate = session.dates_available[0];

    Object.entries(availabilityCounts).forEach(([date, count]) => {
      if ((count as number) > maxCount) {
        maxCount = count as number;
        bestDate = date;
      }
    });

    const minPlayers = session.min_players || parseInt(session.player_count_preference?.split('-')[0]) || 3;
    const maxPlayers = session.max_players || parseInt(session.player_count_preference?.split('-')[1]) || 4;

    // +1 for the host
    return {
      ...session,
      min_players: minPlayers,
      max_players: maxPlayers,
      max_available_count: maxCount + 1,
      best_date: bestDate
    };
  });

  const availableMonths = Array.from(new Set(sessionsWithCounts.flatMap(session => 
    session.dates_available.map(date => date.substring(0, 7))
  ))).sort();

  const filteredSessions = sessionsWithCounts.filter(session => {
    if (filter !== 'all') {
      const isSocial = session.game_name === "交友聚會" || !!session.purpose || !!session.content;
      const isMahjong = ["港式台牌", "廣東牌", "跑馬仔", "越南百搭"].includes(session.game_name) || (!!session.rules && !isSocial);
      const isBoardgame = !isSocial && !isMahjong;

      if (filter === 'social' && !isSocial) return false;
      if (filter === 'mahjong' && !isMahjong) return false;
      if (filter === 'boardgame' && !isBoardgame) return false;
    }

    if (selectedMonth !== 'all') {
      const hasDateInMonth = session.dates_available.some(date => date.startsWith(selectedMonth));
      if (!hasDateInMonth) return false;
    }

    return true;
  }).sort((a, b) => {
    const earliestA = [...a.dates_available].sort()[0];
    const earliestB = [...b.dates_available].sort()[0];
    return earliestA.localeCompare(earliestB);
  });

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center max-w-2xl mx-auto pb-2 space-y-2">
        <div className="max-w-lg mx-auto bg-amber-300 border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] rounded-lg p-2 sm:p-2.5 text-left">
          <p className="text-sm text-black font-bold leading-relaxed">
            <span className="font-black text-rose-600">⚠️ 注意：</span>租場地方場費用自理。本平台只提供聚會約腳資訊，本平台不負責聚會地點/費用/主持質素。請自行 PM Host 主持了解。
          </p>
        </div>
        <div className="max-w-lg mx-auto bg-sky-200 border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] rounded-lg p-2 sm:p-2.5 text-left">
          <p className="text-sm text-black font-bold leading-relaxed">
            <span className="font-black text-indigo-700">💡 約局說明：</span>Host 主持必需留下電話，取得約局專用 Code。為防甩底，參加者要成功報名，必需 WhatsApp Host 主持以取得專用 Code，填入正確 Code 方能成功報名。
          </p>
        </div>
        
        <div className="max-w-lg mx-auto flex flex-col sm:flex-row gap-2 justify-center pt-2">
          <a
            href="https://wa.me/85293737819"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-green-500 hover:bg-green-600 text-white border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] rounded-lg text-xs sm:text-sm font-bold hover:translate-y-[2px] hover:shadow-none transition-all w-full sm:w-auto"
          >
            <MessageCircle className="w-4 h-4 shrink-0" />
            聯絡池記桌遊關於如何使用平台
          </a>
          <a
            href="https://wa.me/85293737819"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-400 hover:bg-amber-500 text-black border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] rounded-lg text-xs sm:text-sm font-bold hover:translate-y-[2px] hover:shadow-none transition-all w-full sm:w-auto"
          >
            <MessageCircle className="w-4 h-4 shrink-0" />
            查詢租用池記桌遊荔枝角場地
          </a>
        </div>
      </div>

      <div>
        <div className="flex flex-col mb-3 gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <h2 className="text-xl sm:text-2xl font-black text-stone-900 inline-block border-b-4 border-orange-400">
                開放中的約局
              </h2>
            </div>
            <Link
              to="/create"
              className="brutal-btn bg-orange-500 hover:bg-orange-600 text-black px-3 py-1.5 text-sm flex items-center"
            >
              <Calendar className="w-4 h-4 mr-1.5" />
              發起新約局
            </Link>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              <button onClick={() => setFilter('all')} className={`px-2 py-1 sm:px-3 sm:py-1.5 rounded-full font-bold text-sm border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-colors ${filter === 'all' ? 'bg-orange-400 text-black' : 'bg-white text-stone-600 hover:bg-stone-100'}`}>全部</button>
              <button onClick={() => setFilter('boardgame')} className={`px-2 py-1 sm:px-3 sm:py-1.5 rounded-full font-bold text-sm border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-colors ${filter === 'boardgame' ? 'bg-orange-400 text-black' : 'bg-white text-stone-600 hover:bg-stone-100'}`}>🎲 桌遊</button>
              <button onClick={() => setFilter('mahjong')} className={`px-2 py-1 sm:px-3 sm:py-1.5 rounded-full font-bold text-sm border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-colors ${filter === 'mahjong' ? 'bg-orange-400 text-black' : 'bg-white text-stone-600 hover:bg-stone-100'}`}>🀄 雀局</button>
              <button onClick={() => setFilter('social')} className={`px-2 py-1 sm:px-3 sm:py-1.5 rounded-full font-bold text-sm border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-colors ${filter === 'social' ? 'bg-orange-400 text-black' : 'bg-white text-stone-600 hover:bg-stone-100'}`}>🤝 交友</button>
            </div>
            
            {availableMonths.length > 0 && (
              <div className="flex items-center gap-2">
                <label htmlFor="month-select" className="text-sm font-bold text-stone-700 whitespace-nowrap">月份:</label>
                <select
                  id="month-select"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="brutal-input py-1 px-2 text-sm font-bold bg-white cursor-pointer"
                >
                  <option value="all">全部月份</option>
                  {availableMonths.map((month: any) => {
                    const [year, m] = month.split('-');
                    return (
                      <option key={month} value={month}>
                        {year}年{parseInt(m)}月
                      </option>
                    );
                  })}
                </select>
              </div>
            )}
          </div>
        </div>
        {filteredSessions.length === 0 ? (
          <div className="brutal-card p-6 text-center bg-stone-100">
            <p className="text-stone-600 font-bold text-xl mb-6">目前沒有開放的約局。</p>
            <Link
              to="/create"
              className="brutal-btn inline-block bg-orange-500 hover:bg-orange-600 text-black px-6 py-3"
            >
              成為第一個發起約局的人吧！
            </Link>
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {filteredSessions.map((session, index) => {
              const bgColors = ['bg-rose-100', 'bg-sky-100', 'bg-orange-100', 'bg-amber-100', 'bg-purple-100'];
              const bgColor = bgColors[index % bgColors.length];
              
              return (
              <div
                key={session.id}
                onClick={() => navigate(`/session/${session.id}`)}
                className={`brutal-card p-1 sm:p-1.5 flex flex-col h-full cursor-pointer relative ${bgColor} hover:bg-white`}
              >
                <div className="mb-1 flex justify-between items-center gap-1">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-2xl sm:text-3xl font-black text-stone-900 leading-none line-clamp-1">
                      {session.game_name}
                    </h3>
                    <p className="text-stone-700 font-bold text-base mt-0.5 leading-none truncate">
                      HOST-主持：{session.host_name}
                    </p>
                  </div>
                  <div className="flex items-start gap-1 shrink-0">
                    <div className="flex items-center justify-center bg-orange-400 text-black px-1.5 py-1 rounded-xl font-black hover:bg-orange-500 transition-colors border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] group text-xs sm:text-sm">
                      按這裡報名!
                      <ChevronRight className="w-3 h-3 sm:w-3.5 sm:h-3.5 ml-0.5 group-hover:translate-x-1 transition-transform" />
                    </div>
                    {isAdmin && (
                      <button
                        onClick={(e) => handleDeleteClick(e, session.id)}
                        className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-100 rounded-full transition-colors z-10"
                        title="刪除約局"
                      >
                        <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-0.5 mt-0.5">
                  {session.game_source !== "N/A" && (
                    <div className="flex items-center gap-1 text-stone-800 font-bold text-sm">
                      <div className="bg-white p-0.5 rounded-md border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
                        <Package className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-500" />
                      </div>
                      <span className="truncate">{session.game_source}</span>
                    </div>
                  )}
                  {session.location && (
                    <div className="flex items-center gap-1 text-stone-800 font-bold text-sm">
                      <div className="bg-white p-0.5 rounded-md border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
                        <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-rose-500" />
                      </div>
                      <span className="truncate">{session.location}</span>
                    </div>
                  )}
                  {session.rules && (
                    <div className="flex items-center gap-1 text-stone-800 font-bold text-sm">
                      <div className="bg-white p-0.5 rounded-md border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
                        <Info className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-500" />
                      </div>
                      <span className="truncate">{session.rules}</span>
                    </div>
                  )}
                  {session.purpose && (
                    <div className="flex items-center gap-1 text-stone-800 font-bold text-sm">
                      <div className="bg-white p-0.5 rounded-md border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
                        <Target className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-500" />
                      </div>
                      <span className="truncate">{session.purpose}</span>
                    </div>
                  )}
                  {session.content && (
                    <div className="flex items-center gap-1 text-stone-800 font-bold text-sm">
                      <div className="bg-white p-0.5 rounded-md border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
                        <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-orange-500" />
                      </div>
                      <span className="truncate">{session.content}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1 text-stone-800 font-bold text-sm">
                    <div className="bg-white p-0.5 rounded-md border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
                      <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-orange-500" />
                    </div>
                    <div className="flex flex-col leading-tight">
                      <span className="truncate">
                        理想人數：{formatPreference(session.player_count_preference)}
                      </span>
                      <span className={session.max_available_count! >= session.min_players ? "text-rose-600 font-black truncate" : "text-amber-600 font-black truncate"}>
                        {session.best_date && `${format(parseISO(session.best_date.split('~')[0]), "M月d日", { locale: zhTW })} `}
                        {session.max_available_count! >= session.max_players
                          ? "已滿團"
                          : session.max_available_count! >= session.min_players 
                          ? `已成團 (可再加 ${session.max_players - session.max_available_count!} 人)` 
                          : `欠 ${session.min_players - session.max_available_count!} 人成團`}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-start gap-1 text-stone-800 font-bold text-sm">
                    <div className="bg-white p-0.5 rounded-md border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] mt-0.5 shrink-0">
                      <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-teal-500" />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {session.dates_available.slice(0, 3).map(date => {
                        const [startStr, endStr] = date.split('~');
                        return (
                          <span key={date} className="bg-white px-1.5 py-0.5 rounded-md border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] inline-block w-fit leading-none">
                            {format(parseISO(startStr), "M月d日 HHmm", { locale: zhTW })}
                            {endStr ? `-${endStr.replace(':', '')}` : ''}
                          </span>
                        );
                      })}
                      {session.dates_available.length > 3 && (
                        <span className="text-stone-500 text-xs font-black">...等 {session.dates_available.length} 個時段</span>
                      )}
                    </div>
                  </div>
                </div>

              </div>
              );
            })}
          </div>
        )}
      </div>

      {sessionToDelete && (
        <div className="fixed inset-0 bg-stone-900/50 flex items-center justify-center z-[100] px-4 backdrop-blur-sm">
          <div className="brutal-card p-4 w-full max-w-sm">
            <h3 className="text-2xl font-black text-stone-900 mb-2">確定要刪除嗎？</h3>
            <p className="text-stone-700 font-bold mb-6">這個動作無法復原，所有相關的回覆也會一併刪除。</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setSessionToDelete(null)} className="brutal-btn bg-stone-200 hover:bg-stone-300 text-black px-3 py-1.5">取消</button>
              <button onClick={confirmDelete} className="brutal-btn bg-rose-500 hover:bg-rose-600 text-white px-3 py-1.5">確定刪除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
