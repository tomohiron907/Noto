# Noto — 開発ガイド

## プロジェクト概要

NotoはGoogle Driveに保存されたMarkdownファイルを閲覧・編集するTauriベースのエディタです。**macOS** と **iOS** の両方で動作します。

**設計目標**:
- UI/UX: Notionのようなクリーンなインターフェース（ブロックエディタ、スラッシュコマンド、インライン書式）
- 拡張性: Obsidianのようなプラグインフレンドリーなアーキテクチャ
- パフォーマンス: 巨大なファイルでもサクサク動く快適な編集体験

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | React 19, TypeScript 5.8, Vite 7 |
| エディタ | TipTap 3（ProseMirrorベース）+ `tiptap-markdown` |
| 状態管理 | Zustand 5 + Immerミドルウェア |
| スタイリング | Tailwind CSS 4 |
| バックエンド | Rust（Tauri 2） |
| ストレージ | Google Drive API v3 |
| 認証 | Google OAuth 2.0（PKCEフロー、ディープリンク経由） |

## ビルドコマンド

```bash
# macOS — デバッグ / ライブリロード
npm run tauri dev

# iOS — シミュレーター（ライブリロード）
npm run ios

# iOS — リリースビルド
npm run ios:build

# iOS — 実機
npm run ios:device

# フロントエンド型チェック
npm run build

# バックエンド型チェック / 借用チェック（src-tauri/ 内で実行）
cargo check
```

## ディレクトリ構成

```
Noto/
├── src/                        # Reactフロントエンド
│   ├── components/
│   │   ├── auth/               # 認証UI
│   │   ├── editor/             # TipTapエディタ、BubbleMenu、SlashMenu
│   │   ├── layout/             # AppShell、Sidebar、NoteCard
│   │   └── ui/                 # 共通UIコンポーネント
│   ├── hooks/                  # useAutoSave
│   ├── lib/                    # tauri.ts, types.ts, markdown.ts, markdownPaste.ts
│   ├── stores/                 # authStore.ts, notesStore.ts（Zustand）
│   └── App.tsx
└── src-tauri/
    └── src/
        ├── auth/               # oauth.rs, token_store.rs, commands.rs, types.rs
        ├── drive/              # client.rs, commands.rs, types.rs
        ├── lib.rs              # Tauriアプリのセットアップ・プラグイン登録
        └── main.rs
```

## 開発ガイドライン

### 実装後に必ず実行すること

タスク完了を報告する前に、必ず以下のチェックを実行してください:

```bash
# 1. TypeScript型チェック
npm run build

# 2. Rust構文・借用チェック
cd src-tauri && cargo check
```

エラーと警告をすべて修正してから完了とすること。

### フロントエンド

- 状態の変更は **Zustand + Immer** を使う — 直接ミューテーションするように書く。
- エディタの新機能は **TipTapエクステンション** として追加する — ProseMirrorを直接触らない。
- ダーク/ライトモードは `prefers-color-scheme` に従う（Tailwindの `dark:` バリアント使用）。
- キーボードショートカットは `App.tsx` に登録する（`Cmd+N`、`Cmd+Shift+Backspace` など）。
- ノートのコンテンツは遅延読み込み — 一覧はメタデータのみ取得し、開いたときにコンテンツを取得する。

### バックエンド（Rust）

- Tauriコマンドは各モジュール（`auth/`、`drive/`）内の `commands.rs` に集約する。
- プラットフォーム固有のコードは `#[cfg(desktop)]` / `#[cfg(target_os = "ios")]` で分岐する。
- トークンリフレッシュとDrive HTTPコールは非同期（`tokio`）。エラー伝播は `?` で簡潔に保つ。
- Google APIのHTTPコールは `drive/client.rs` にまとめる — 新しいエンドポイントはここに追加する。

### パフォーマンス

- キーを押すたびにエディタが再レンダリングされないようにする — 自動保存はデバウンスする（`useAutoSave` 参照）。
- Drive APIの重複呼び出しを避けるため、ノートIDによるコンテンツキャッシュを活用する。
- 大きなファイルは、一度にすべてメモリに読み込むのではなく、ストリーミングまたはチャンク読み込みを優先する。

## テスト

### バックエンド — 必須

すべてのビジネスロジックにRustユニットテストを書くこと。各モジュールファイルの末尾に `#[cfg(test)]` ブロックとして追加する:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_example() {
        // arrange → act → assert
    }

    #[tokio::test]
    async fn test_async_example() {
        // 非同期テストはtokio::testが必要
    }
}
```

**テスト対象**:
- トークンのパース、リフレッシュロジック、有効期限チェック（`auth/`）
- Drive APIレスポンスのパースとエラーハンドリング（`drive/`）
- URL構築、クエリパラメータのエンコード
- 純粋関数（シリアライズ、型変換など）

テスト実行:

```bash
cd src-tauri && cargo test
```

### フロントエンド — 最低限

TypeScriptのコンパイル（`npm run build`）がエラーなく通ること。ロジックが複雑な場合はコンポーネントテストも追加する。

## 主要ファイル

| ファイル | 役割 |
|---------|------|
| `src/stores/notesStore.ts` | ノート一覧、アクティブノート、未保存状態の管理 |
| `src/stores/authStore.ts` | 認証状態、サインイン/アウト |
| `src/components/editor/NoteEditor.tsx` | TipTapエディタのメインコンポーネント |
| `src/components/editor/SlashMenu.tsx` | スラッシュコマンドパレット |
| `src/lib/tauri.ts` | RustのTauriコマンドへのフロントエンドラッパー |
| `src-tauri/src/drive/client.rs` | Google Drive HTTPクライアント |
| `src-tauri/src/auth/oauth.rs` | OAuth 2.0 PKCEフロー |
| `src-tauri/src/auth/token_store.rs` | トークンの永続化ストレージ |
| `src-tauri/tauri.conf.json` | Tauri設定（ウィンドウサイズ、ディープリンクスキーム） |

## 注意事項

- `tauri.conf.json` のCSPは意図的に `null` に設定されている — OAuthディープリンクとDrive APIコールを確認せずに制限的なCSPを追加しないこと。
- OAuthリダイレクトは `tauri-plugin-deep-link` のカスタムURLスキームを使用 — スキームを変更する場合は `tauri.conf.json` とGoogle Cloud ConsoleのOAuth設定の両方を更新すること。
