import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, globalErrors: [] };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  componentDidMount() {
    window.addEventListener('error', this.handleGlobalError);
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.handleGlobalError);
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  handleGlobalError = (event) => {
    this.setState(prev => ({
      globalErrors: [...prev.globalErrors, `Global Error: ${event.message} at ${event.filename}:${event.lineno}`]
    }));
  };

  handleUnhandledRejection = (event) => {
    this.setState(prev => ({
      globalErrors: [...prev.globalErrors, `Unhandled Rejection: ${event.reason?.message || event.reason}`]
    }));
  };

  render() {
    if (this.state.hasError || this.state.globalErrors.length > 0) {
      return (
        <div style={{ padding: '20px', color: 'white', backgroundColor: '#8b0000', minHeight: '100vh', zIndex: 9999, position: 'relative' }}>
          <h2>Something went wrong.</h2>
          {this.state.hasError && (
            <details style={{ whiteSpace: 'pre-wrap', marginBottom: '20px' }}>
              {this.state.error && this.state.error.toString()}
              <br />
              {this.state.errorInfo && this.state.errorInfo.componentStack}
            </details>
          )}
          {this.state.globalErrors.length > 0 && (
            <div>
              <h3>Global Errors:</h3>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: '12px', background: 'rgba(0,0,0,0.5)', padding: '10px' }}>
                {this.state.globalErrors.join('\n\n')}
              </pre>
            </div>
          )}
          <button onClick={() => window.location.reload()} style={{ marginTop: '20px', padding: '10px', background: 'white', color: 'black' }}>
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

