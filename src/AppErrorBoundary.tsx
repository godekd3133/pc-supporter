import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export function appErrorMessageFor(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 240);
  return "화면을 준비하는 중 알 수 없는 오류가 발생했습니다.";
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(appErrorMessageFor(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 서버 전송이나 개인정보 수집 없이 현재 탭의 개발자 콘솔에만 남깁니다.
    console.error("[PC Supporter] 화면 렌더링 오류", error, info.componentStack);
  }

  retryCurrentScreen = () => {
    this.setState({ error: null });
  };

  reloadApplication = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-error-boundary" role="alert" aria-labelledby="app-error-title">
        <div className="app-error-boundary-card">
          <span className="app-error-boundary-mark" aria-hidden="true">!</span>
          <h1 id="app-error-title">잠시 문제가 생겼어요.<br />다시 시도해 주세요.</h1>
          <div className="app-error-boundary-actions">
            <button className="button button-primary" type="button" onClick={this.retryCurrentScreen}>다시 시도</button>
            <button className="button button-light" type="button" onClick={this.reloadApplication}>새로 불러오기</button>
          </div>
        </div>
      </main>
    );
  }
}
