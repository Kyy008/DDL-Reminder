package com.kyy.ddlreminder;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.AtomicFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

@CapacitorPlugin(name = "AssistantBridge")
public class AssistantBridgePlugin extends Plugin {
    private static final String KEY_ALIAS = "ddl-reminder-assistant-api-key-v1";
    private final Map<String, HttpsURLConnection> requests = new ConcurrentHashMap<>();
    private final java.util.Set<String> cancelled = ConcurrentHashMap.newKeySet();
    private final java.util.Set<String> active = ConcurrentHashMap.newKeySet();
    private final java.util.concurrent.ExecutorService networkExecutor = java.util.concurrent.Executors.newSingleThreadExecutor();

    @PluginMethod
    public void getCredentialStatus(PluginCall call) {
        execute(() -> {
            try { call.resolve(credentialStatus()); }
            catch (Exception error) { call.reject("无法读取 API 密钥，请在设置中重新保存。", "CREDENTIAL_READ_FAILED"); }
        });
    }

    @PluginMethod
    public void setApiKey(PluginCall call) {
        String key = call.getString("key", "").trim();
        if (!key.isEmpty() && !key.matches("[A-Za-z0-9_-]{8,512}")) {
            call.reject("API 密钥格式有误，请检查是否多复制了空格或其他文字。", "INVALID_API_KEY");
            return;
        }
        execute(() -> {
            try {
                synchronized (this) {
                    File file = credentialFile();
                    if (key.isEmpty()) {
                        new AtomicFile(file).delete();
                        if (file.exists()) throw new Exception("delete failed");
                    } else {
                        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey());
                        JSONObject record = new JSONObject();
                        record.put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP));
                        record.put("data", Base64.encodeToString(cipher.doFinal(key.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
                        AtomicFile atomic = new AtomicFile(file);
                        java.io.FileOutputStream output = null;
                        try {
                            output = atomic.startWrite();
                            output.write(record.toString().getBytes(StandardCharsets.UTF_8));
                            atomic.finishWrite(output);
                        } catch (Exception error) { if (output != null) atomic.failWrite(output); throw error; }
                    }
                }
                call.resolve(credentialStatus());
            } catch (Exception error) { call.reject("密钥未能保存，请重试。原密钥未主动清除。", "CREDENTIAL_SAVE_FAILED"); }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("requestId", "");
        if (!id.isEmpty() && active.contains(id)) {
            cancelled.add(id);
            HttpsURLConnection connection = requests.get(id);
            if (connection != null) connection.disconnect();
        }
        call.resolve();
    }

    @PluginMethod
    public void complete(PluginCall call) {
        String id = call.getString("requestId", "");
        String payload = call.getString("payload", "");
        if (!id.matches("[A-Za-z0-9-]{1,100}") || payload.length() > 2_000_000) {
            call.reject("本次对话过长，请清空对话后重试。", "INVALID_REQUEST");
            return;
        }
        if (!active.add(id)) { call.reject("这条消息正在处理。", "REQUEST_BUSY"); return; }
        if (active.size() > 1) { active.remove(id); call.reject("请等当前回答结束，或先停止回答。", "REQUEST_BUSY"); return; }
        // The native bridge owns the destination and key. Neither model output
        // nor web content can change the host or ask this bridge to run tools.
        networkExecutor.execute(() -> {
            HttpsURLConnection connection = null;
            try {
                if (cancelled.contains(id)) throw new InterruptedException();
                String key = readApiKey();
                if (key.isEmpty()) {
                    call.reject("请先在设置的“对话助手”中填写 DeepSeek API 密钥。", "API_KEY_REQUIRED");
                    return;
                }
                JSONObject body = new JSONObject(payload);
                if (!"deepseek-flash".equals(body.optString("model")) || body.optJSONArray("messages") == null || body.optBoolean("stream")) {
                    call.reject("对话请求格式有误。", "INVALID_REQUEST");
                    return;
                }
                connection = (HttpsURLConnection) new URL("https://api.deepseek.com/chat/completions").openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(20_000);
                connection.setReadTimeout(300_000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("Authorization", "Bearer " + key);
                requests.put(id, connection);
                if (cancelled.contains(id)) throw new InterruptedException();
                byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
                int status = connection.getResponseCode();
                if (cancelled.contains(id)) throw new InterruptedException();
                if (status != 200) {
                    String message;
                    if (status == 401 || status == 403) message = "API 密钥无效或没有访问权限，请在设置中检查。";
                    else if (status == 402) message = "DeepSeek 账户余额不足，请充值或更换 API 密钥。";
                    else if (status == 429) message = "请求较多，DeepSeek 暂时限流，请稍后再试。";
                    else if (status >= 500) message = "DeepSeek 服务暂时不可用，请稍后重试。";
                    else message = "DeepSeek 未接受本次请求（" + status + "），请重试或缩小问题范围。";
                    call.reject(message, "DEEPSEEK_HTTP_" + status);
                    return;
                }
                String response;
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (cancelled.contains(id)) throw new InterruptedException();
                        if (output.size() + count > 4_000_000) throw new Exception("response too large");
                        output.write(buffer, 0, count);
                    }
                    response = output.toString(StandardCharsets.UTF_8.name());
                }
                JSObject result = new JSObject(); result.put("body", response); call.resolve(result);
            } catch (Exception error) {
                if (cancelled.contains(id) || error instanceof InterruptedException) call.reject("已停止本次回答。", "CANCELLED");
                else if (error instanceof java.net.SocketTimeoutException) call.reject("网络请求超时，请检查网络后重试。", "TIMEOUT");
                else call.reject("无法连接 DeepSeek，请检查网络或稍后重试。", "NETWORK_ERROR");
            } finally {
                requests.remove(id); cancelled.remove(id); active.remove(id);
                if (connection != null) connection.disconnect();
            }
        });
    }

    private File credentialFile() { return new File(getContext().getNoBackupFilesDir(), "ddl-assistant-key.enc"); }
    private SecretKey encryptionKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            return generator.generateKey();
        }
        return (SecretKey) store.getKey(KEY_ALIAS, null);
    }
    private synchronized String readCustomApiKey() throws Exception {
        File file = credentialFile();
        byte[] data;
        try { data = new AtomicFile(file).readFully(); }
        catch (java.io.FileNotFoundException missing) { return ""; }
        JSONObject record = new JSONObject(new String(data, StandardCharsets.UTF_8));
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), new GCMParameterSpec(128, Base64.decode(record.getString("iv"), Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(record.getString("data"), Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
    private String readApiKey() throws Exception {
        String custom = readCustomApiKey();
        return custom.isEmpty() ? BuildConfig.DEEPSEEK_PRESET_KEY : custom;
    }
    private JSObject credentialStatus() throws Exception {
        boolean custom = !readCustomApiKey().isEmpty();
        boolean preset = !BuildConfig.DEEPSEEK_PRESET_KEY.isEmpty();
        JSObject result = new JSObject();
        result.put("hasKey", custom || preset); result.put("hasPreset", preset); result.put("usingCustomKey", custom);
        return result;
    }
    @Override
    protected void handleOnDestroy() {
        for (HttpsURLConnection connection : requests.values()) connection.disconnect();
        networkExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
