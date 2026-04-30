// Registers UIPencilInteraction on the Tauri WKWebView.
// When the user double-taps the Apple Pencil body, dispatches a
// 'pencil-double-tap' CustomEvent to the web layer so InkEditor
// can toggle eraser mode without native UI.
//
// pencilSetupInit() is called explicitly from main.mm before start_app().

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

static WKWebView* findWebView(UIView* view) {
  if ([view isKindOfClass:[WKWebView class]]) return (WKWebView*)view;
  for (UIView* sub in view.subviews) {
    WKWebView* found = findWebView(sub);
    if (found) return found;
  }
  return nil;
}

@interface PencilDelegate : NSObject <UIPencilInteractionDelegate>
@property (nonatomic, weak) WKWebView* webView;
@end

@implementation PencilDelegate
- (void)pencilInteractionDidTap:(UIPencilInteraction*)interaction {
  WKWebView* wv = self.webView;
  if (!wv) return;
  [wv evaluateJavaScript:@"window.dispatchEvent(new CustomEvent('pencil-double-tap'))"
       completionHandler:nil];
}
@end

// Retained for app lifetime
static PencilDelegate* gDelegate = nil;

static void attachPencilInteraction(void) {
  if (gDelegate) return;

  UIWindowScene* scene = nil;
  for (UIScene* s in UIApplication.sharedApplication.connectedScenes) {
    if ([s isKindOfClass:[UIWindowScene class]]) {
      scene = (UIWindowScene*)s;
      break;
    }
  }
  UIWindow* window = scene.windows.firstObject;
  if (!window) return;

  UIView* root = window.rootViewController.view ?: window;
  WKWebView* webView = findWebView(root);
  if (!webView) return;

  gDelegate = [[PencilDelegate alloc] init];
  gDelegate.webView = webView;

  UIPencilInteraction* interaction = [[UIPencilInteraction alloc] init];
  interaction.delegate = gDelegate;
  [webView addInteraction:interaction];
}

extern "C" void pencilSetupInit(void) {
  [[NSNotificationCenter defaultCenter]
      addObserverForName:UIApplicationDidBecomeActiveNotification
                  object:nil
                   queue:[NSOperationQueue mainQueue]
              usingBlock:^(NSNotification* _) {
                attachPencilInteraction();
              }];
}
