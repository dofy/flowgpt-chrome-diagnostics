# Chrome Web Store listing

## Description

Record failed network requests on FlowGPT or Emochi and export one diagnostic ZIP for support. The report helps support correlate a failed request with its timestamp, HTTP status and Cloudflare Ray ID.

Open the affected tab, start recording and repeat the action that failed. The page shows recording progress in that tab. Filter captured requests by area or failure type to locate a sign-in problem, Cloudflare challenge, server error, or image request blocked by the browser.

Recording lasts up to five minutes per tab. You can copy the selected report or download a ZIP with all recorded failures, the selected report and a screenshot of the visible page. The extension keeps records in Chrome and lets you choose what you send to support. A report can contain the request path, a public IP measurement and, for image or ZIP exports, a screenshot of the webpage. Review the contents before sharing.

## Single purpose

Record and export diagnostics for failed requests to FlowGPT and Emochi.

## Permission justifications

- webRequest. Observe failed network requests during a recording in the tab the user starts.
- storage. Hold the current diagnostic session and captured failures in Chrome’s in-memory session storage.
- activeTab. Capture the visible webpage when the user chooses a diagnostic image or ZIP.
- scripting. Show recording progress and read a matching Cloudflare error footer when it helps identify the failure or public IP.
- alarms. End the recording automatically after five minutes, even when the extension popup is closed.
- Host access. Record eligible errors on FlowGPT, Emochi and flow.chat HTTPS hosts and obtain a public IP measurement for the affected host when the error page cannot provide it. Access covers their sign-in, API and image subdomains.

## Reviewer steps

1. Open https://emochi.com in desktop Chrome. No sign-in is needed for this test.
2. Open the extension and select **Start recording**. The page displays a recording panel.
3. In the same tab, visit https://emochi.com/images/connection-diagnostics-test-not-found.png. This test URL returns HTTP 404 so you can verify that the extension records a failed request.
4. Open the extension again and select **Stop recording**, then select **Download ZIP** to verify the local export.

## Privacy policy

https://gist.github.com/dofy/f5e7c25a12ac484ed91fd80d9a52cbe8
