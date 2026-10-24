document.addEventListener("DOMContentLoaded", () => {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
        const App = window.Capacitor.Plugins.App;

        App.addListener("backButton", ({ canGoBack }) => {
            if (canGoBack && window.history.length > 1) {
                window.history.back();
            } else {
                App.exitApp();
            }
        });
    }
});
