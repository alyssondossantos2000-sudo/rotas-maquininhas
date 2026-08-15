// Único arquivo do projeto que passa por bundler (esbuild) — só ele, não o app inteiro. O resto
// do projeto continua zero-build-step de propósito (js/*.js são módulos ES carregados direto pelo
// navegador). O motivo: os pacotes nativos do Capacitor (@capacitor/core, @capacitor/filesystem,
// @capacitor-mlkit/text-recognition) têm dependências internas (ex: "synapse") que só se resolvem
// direito passando por um bundler de verdade — tentar simular isso com <script> globais soltos
// deu "ReferenceError: synapse is not defined" (achado testando no celular real).
//
// Empacotado por scripts/build-www.mjs em www/vendor/native-plugins.js, carregado como <script>
// comum no index.html. Só existe/roda dentro do APK — no site (GitHub Pages) esse arquivo nem é
// gerado, e o resto do código só usa window.NativePlugins quando window.Capacitor.isNativePlatform()
// é true.
import "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { TextRecognition } from "@capacitor-mlkit/text-recognition";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";

window.NativePlugins = { Filesystem, Directory, TextRecognition, Camera, CameraResultType, CameraSource };
