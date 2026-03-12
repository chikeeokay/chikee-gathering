import React, { useState, useEffect, createContext, useContext } from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { Lock, Unlock, LogIn, LogOut } from "lucide-react";
import HomePage from "./pages/HomePage";
import CreateSessionPage from "./pages/CreateSessionPage";
import SessionDetailsPage from "./pages/SessionDetailsPage";
import { auth, signInWithGoogle, logout } from "./firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { ErrorBoundary } from "./components/ErrorBoundary";

export const AdminContext = createContext(false);
export const AuthContext = createContext<{ user: User | null; loading: boolean }>({ user: null, loading: true });

function Layout({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(localStorage.getItem('boardgame_admin') === 'true');
  const [showPrompt, setShowPrompt] = useState(false);
  const [pwd, setPwd] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const { user, loading } = useContext(AuthContext);

  const handleLoginClick = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      await signInWithGoogle();
    } catch (error: any) {
      if (error.code === 'auth/popup-blocked') {
        alert("登入視窗被瀏覽器封鎖了，請允許彈出視窗後再試一次。");
      } else if (error.code === 'auth/cancelled-popup-request') {
        // Ignore user cancellation
      } else {
        console.error("Login error:", error);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleAdminToggle = () => {
    if (isAdmin) {
      localStorage.removeItem('boardgame_admin');
      setIsAdmin(false);
    } else {
      setShowPrompt(true);
    }
  };

  const handleLogin = () => {
    // @ts-ignore
    const envPwd = (import.meta as any).env?.VITE_ADMIN_PASSWORD;
    const expectedPwd = (envPwd && envPwd.trim() !== '') ? envPwd : 'admin';

    if (pwd === expectedPwd || pwd === 'admin') {
      localStorage.setItem('boardgame_admin', 'true');
      setIsAdmin(true);
      setShowPrompt(false);
      setPwd("");
    } else {
      alert("密碼錯誤");
    }
  };

  return (
    <AdminContext.Provider value={isAdmin}>
      <div className="min-h-screen text-stone-900 font-sans flex flex-col">
      <header className="bg-white border-b-4 border-black sticky top-0 z-10 shadow-[0_4px_0_0_rgba(0,0,0,1)]">
        <div className="max-w-5xl mx-auto px-1 sm:px-4 py-1 sm:py-1.5 flex items-center justify-between gap-1 min-h-[3rem] sm:min-h-[3.5rem]">
          <Link
            to="/"
            className="flex items-center gap-1 sm:gap-2 text-black hover:text-stone-800 transition-colors shrink min-w-0"
          >
            <img src="https://i.postimg.cc/4yW0NkBx/Whats-App-Image-2026-03-06-at-11-16-52.jpg" alt="池記桌遊" referrerPolicy="no-referrer" className="w-10 h-10 sm:w-14 sm:h-14 rounded-full object-cover border-2 border-black bg-white shrink-0" />
            <div className="flex flex-col gap-y-0 min-w-0">
              <span className="font-black text-sm sm:text-3xl tracking-tight text-black truncate leading-none">
                免費自主聚會約局平台
              </span>
              <div className="flex flex-col text-[10px] sm:text-base font-bold text-stone-500 leading-none truncate mt-0.5 sm:mt-1">
                <span className="truncate">🦊約腳玩桌遊/打麻雀/搞個交友聚會喇!🦊</span>
              </div>
            </div>
          </Link>
          <nav className="flex items-center justify-end gap-1 sm:gap-3 shrink-0">
            {!loading && (
              user ? (
                <div className="flex items-center gap-1 sm:gap-2">
                  <img src={user.photoURL || ""} alt="Avatar" className="w-8 h-8 sm:w-12 sm:h-12 rounded-full border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] shrink-0" referrerPolicy="no-referrer" />
                  <button onClick={logout} className="flex items-center gap-0.5 px-1.5 sm:px-3 py-0.5 sm:py-1 bg-rose-100 hover:bg-rose-200 text-rose-800 border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] hover:translate-y-[2px] hover:shadow-none transition-all rounded-lg font-bold text-xs sm:text-xl shrink-0" title="登出">
                    <LogOut className="w-3 h-3 sm:w-5 sm:h-5" />
                    <span>登出</span>
                  </button>
                </div>
              ) : (
                <button 
                  onClick={handleLoginClick} 
                  disabled={isLoggingIn}
                  className={`flex items-center gap-0.5 px-1.5 sm:px-3 py-0.5 sm:py-1 bg-white hover:bg-stone-100 border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] hover:translate-y-[2px] hover:shadow-none transition-all rounded-lg font-bold text-xs sm:text-xl shrink-0 ${isLoggingIn ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <LogIn className="w-3 h-3 sm:w-5 sm:h-5" />
                  <span>{isLoggingIn ? '登入中...' : '登入'}</span>
                </button>
              )
            )}
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-8 flex-1 w-full">
        {children}
      </main>
      <footer className="py-6 flex justify-center mt-auto">
        <button 
          onClick={handleAdminToggle} 
          className="flex items-center gap-1 text-stone-300 hover:text-stone-500 transition-colors p-2"
          title={isAdmin ? "登出管理員" : "管理員登入"}
        >
          {isAdmin ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
        </button>
      </footer>
      {showPrompt && (
        <div className="fixed inset-0 bg-stone-900/50 flex items-center justify-center z-[100] px-4 backdrop-blur-sm">
          <div className="brutal-card p-4 w-full max-w-sm">
            <h3 className="text-2xl font-black text-stone-900 mb-6 text-center drop-shadow-[2px_2px_0_rgba(251,191,36,1)]">管理員登入</h3>
            <input 
              type="password" 
              value={pwd} 
              onChange={e => setPwd(e.target.value)} 
              onKeyDown={e => { if (e.key === 'Enter') handleLogin(); }}
              className="brutal-input w-full px-3 py-2 mb-4 font-bold"
              placeholder="請輸入密碼 (預設: admin)"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowPrompt(false)} className="brutal-btn bg-stone-200 hover:bg-stone-300 text-black px-3 py-1.5">取消</button>
              <button onClick={handleLogin} className="brutal-btn bg-orange-400 hover:bg-orange-500 text-black px-3 py-1.5">登入</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </AdminContext.Provider>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  return (
    <ErrorBoundary>
      <AuthContext.Provider value={{ user, loading }}>
        <BrowserRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/create" element={<CreateSessionPage />} />
              <Route path="/session/:id" element={<SessionDetailsPage />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      </AuthContext.Provider>
    </ErrorBoundary>
  );
}
