/** Firebase のウェブアプリ設定。
 *  この値はクライアントに埋め込む前提で公開されるもので、秘密ではない。
 *  データの保護は、パスワード認証（Firebase 側で照合）と
 *  Firestore のセキュリティルールで行う。 */
export const firebaseConfig = {
  apiKey: 'AIzaSyDdyi3BsybB1jb-Bd0d9OuW1se8up72Tvc',
  authDomain: 'yomicam-driving.firebaseapp.com',
  projectId: 'yomicam-driving',
  storageBucket: 'yomicam-driving.firebasestorage.app',
  messagingSenderId: '847680051814',
  appId: '1:847680051814:web:688a746d450000880faba7',
};
