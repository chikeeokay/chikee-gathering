import * as React from "react";
import { ErrorInfo, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "發生未知的錯誤。";
      let errorDetails = "";

      if (this.state.error) {
        try {
          // Check if it's our custom Firestore error JSON
          const parsedError = JSON.parse(this.state.error.message);
          if (parsedError && parsedError.error) {
            errorMessage = "資料庫存取錯誤";
            errorDetails = parsedError.error;
            
            if (errorDetails.includes("Missing or insufficient permissions")) {
              errorMessage = "權限不足";
              errorDetails = "您沒有權限執行此操作。請確認您已登入，或聯絡管理員。";
            }
          } else {
            errorMessage = this.state.error.message;
          }
        } catch (e) {
          // Not JSON, just use the message
          errorMessage = this.state.error.message;
        }
      }

      return (
        <div className="min-h-screen bg-amber-50 flex items-center justify-center p-4">
          <div className="brutal-card p-8 max-w-md w-full bg-white text-center">
            <AlertTriangle className="w-16 h-16 mx-auto text-rose-500 mb-4" />
            <h1 className="text-3xl font-black text-stone-900 mb-4">哎呀！出錯了</h1>
            <div className="bg-rose-100 border-4 border-rose-500 p-4 rounded-xl mb-6 text-left">
              <p className="font-bold text-rose-900 mb-1">{errorMessage}</p>
              {errorDetails && (
                <p className="text-sm text-rose-700">{errorDetails}</p>
              )}
            </div>
            <button
              onClick={() => window.location.href = '/'}
              className="brutal-btn bg-emerald-400 hover:bg-emerald-500 text-black px-6 py-3 w-full"
            >
              返回首頁
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
