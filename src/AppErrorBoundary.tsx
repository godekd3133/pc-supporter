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
          <p className="eyebrow">RECOVERY MODE</p>
          <h1 id="app-error-title">화면을 불러오지 못했습니다.</h1>
          <p>일시적인 화면 오류가 발생했습니다. 입력한 견적·로컬 프리셋·저장된 검사 결과는 지우지 않고 화면만 다시 시도합니다.</p>
          <div className="app-error-boundary-actions">
            <button className="button button-primary" type="button" onClick={this.retryCurrentScreen}>현재 화면 다시 시도</button>
            <button className="button button-light" type="button" onClick={this.reloadApplication}>서비스 다시 불러오기</button>
          </div>
          <small>계속 문제가 발생하면 브라우저를 새로고침한 뒤 같은 URL로 다시 열어 주세요.</small>
        </div>
      </main>
    );
  }
}
