package app.cmfeq.bluetooth

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.os.Build
import android.os.SystemClock
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Byte transport only. The existing Rust controller owns every headphone command. */
@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.BLUETOOTH_CONNECT], alias = "bluetooth")])
class BluetoothPlugin(private val activity: Activity) : Plugin(activity) {
    private val worker = Executors.newSingleThreadExecutor()
    private val timer = Executors.newSingleThreadScheduledExecutor()
    private val sockets = ConcurrentHashMap<String, BluetoothSocket>()
    // Same Nothing control service UUID as the Windows RFCOMM implementation.
    private val service = UUID.fromString("AEAC4A03-DFF5-498F-843A-34487CF133EB")

    private fun authorized(): Boolean = Build.VERSION.SDK_INT < 31 || getPermissionState("bluetooth") == PermissionState.GRANTED

    private fun execute(invoke: Invoke, needsBluetooth: Boolean = true, block: () -> Any) {
        try {
            worker.execute {
                try {
                    if (needsBluetooth && !authorized()) throw SecurityException("Allow Nearby devices in Android app settings, then Refresh.")
                    invoke.resolveObject(block())
                } catch (error: Exception) { invoke.reject(error.message ?: "Bluetooth operation failed.") }
            }
        } catch (error: Exception) { invoke.reject("Bluetooth activity closed. Reopen the app.") }
    }

    @Command
    fun pairedDevices(invoke: Invoke) {
        if (!authorized()) { requestPermissionForAlias("bluetooth", invoke, "bluetoothPermission"); return }
        listPaired(invoke)
    }

    @PermissionCallback
    fun bluetoothPermission(invoke: Invoke) {
        if (authorized()) listPaired(invoke)
        else invoke.reject("Nearby devices permission is needed to list your paired headphones. Allow it in Android app settings, then Refresh.")
    }

    @SuppressLint("MissingPermission")
    private fun adapter() = (activity.getSystemService(Activity.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        ?.also { if (!it.isEnabled) throw IOException("Turn on Bluetooth in Android settings, then Refresh.") }
        ?: throw IOException("Bluetooth is unavailable on this phone.")

    @SuppressLint("MissingPermission")
    private fun listPaired(invoke: Invoke) = execute(invoke) {
        val devices = adapter().bondedDevices.map { device ->
            val name = device.name ?: "Bluetooth device"
            val lower = name.lowercase()
            mapOf("name" to name, "address" to device.address,
                "likely_headphones" to (lower.contains("cmf") || lower.contains("headphone") || lower.contains("b175")))
        }.sortedBy { it["name"].toString() }
        mapOf("devices" to devices)
    }

    @Command
    @SuppressLint("MissingPermission")
    fun connect(invoke: Invoke) = execute(invoke) {
        val address = invoke.getArgs().getString("address")
        val device = adapter().bondedDevices.firstOrNull { it.address.equals(address, ignoreCase = true) }
            ?: throw IOException("Pair these headphones in Android Bluetooth settings first.")
        // A dropped Rust session may still have an asynchronous close queued.
        // Each handle has its own ID, so a late close never closes the new socket.
        sockets.values.forEach { runCatching { it.close() } }; sockets.clear()
        val socket = device.createRfcommSocketToServiceRecord(service)
        val id = UUID.randomUUID().toString()
        sockets[id] = socket
        val timeout = timer.schedule({ runCatching { socket.close() } }, 20, TimeUnit.SECONDS)
        try {
            socket.connect()
            mapOf("id" to id)
        } catch (error: Exception) {
            sockets.remove(id); runCatching { socket.close() }
            throw IOException("Could not connect to the headphone control service. Close Nothing X and the PC companion, then reconnect. ${error.message}")
        } finally { timeout.cancel(false) }
    }

    private fun socket(invoke: Invoke): BluetoothSocket = sockets[invoke.getArgs().getString("id")]
        ?: throw IOException("Bluetooth session closed. Reconnect the headphones.")

    @Command
    fun send(invoke: Invoke) = execute(invoke) {
        val args = invoke.getArgs()
        val data = args.getJSONArray("bytes")
        require(data.length() in 1..8202) { "Invalid Bluetooth packet size." }
        val bytes = ByteArray(data.length()) { index ->
            val value = data.getInt(index); require(value in 0..255); value.toByte()
        }
        val socket = socket(invoke)
        val timeout = timer.schedule({ runCatching { socket.close() } }, args.getLong("timeoutMs").coerceIn(1, 20000), TimeUnit.MILLISECONDS)
        try {
            socket.outputStream.write(bytes); socket.outputStream.flush()
            mapOf("ok" to true)
        } finally { timeout.cancel(false) }
    }

    @Command
    fun receive(invoke: Invoke) = execute(invoke) {
        val args = invoke.getArgs()
        val socket = socket(invoke)
        val stream = socket.inputStream
        val deadline = SystemClock.elapsedRealtime() + args.getLong("timeoutMs").coerceIn(1, 20000)
        val limit = args.getInt("limit").coerceIn(1, 8192)
        while (stream.available() == 0) {
            if (!socket.isConnected) throw IOException("Bluetooth disconnected.")
            if (SystemClock.elapsedRealtime() >= deadline) throw IOException("Bluetooth response timed out.")
            Thread.sleep(10)
        }
        val bytes = ByteArray(minOf(limit, stream.available()))
        val count = stream.read(bytes)
        if (count < 0) throw IOException("Headphones closed the control connection.")
        mapOf("bytes" to bytes.take(count).map { it.toInt() and 255 })
    }

    @Command
    fun close(invoke: Invoke) = execute(invoke, false) {
        sockets.remove(invoke.getArgs().getString("id"))?.close()
        mapOf("ok" to true)
    }

    @Command
    fun importText(invoke: Invoke) {
        try {
            startActivityForResult(invoke, Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE); type = "*/*"
            }, "importResult")
        } catch (error: Exception) { invoke.reject(error.message) }
    }

    @ActivityCallback
    fun importResult(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) { invoke.resolve(); return }
        execute(invoke, false) {
            val bytes = activity.contentResolver.openInputStream(uri)?.use { stream ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val count = stream.read(buffer); if (count < 0) break
                    require(output.size() + count <= 256 * 1024) { "Profile exceeds 256 KB." }
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            } ?: throw IOException("Could not open profile file.")
            var name = "Imported profile"
            activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) name = it.getString(0) ?: name
            }
            mapOf("name" to name.removeSuffix(".txt"), "text" to bytes.toString(Charsets.UTF_8))
        }
    }

    @Command
    fun exportText(invoke: Invoke) {
        try {
            val args = invoke.getArgs()
            require(args.getString("text").toByteArray(Charsets.UTF_8).size <= 256 * 1024)
            startActivityForResult(invoke, Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE); type = "text/plain"
                putExtra(Intent.EXTRA_TITLE, args.getString("name"))
            }, "exportResult")
        } catch (error: Exception) { invoke.reject(error.message) }
    }

    @ActivityCallback
    fun exportResult(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) { invoke.resolveObject(mapOf("saved" to false)); return }
        execute(invoke, false) {
            activity.contentResolver.openOutputStream(uri, "wt")?.use {
                it.write(invoke.getArgs().getString("text").toByteArray(Charsets.UTF_8)); it.flush()
            } ?: throw IOException("Could not save profile file.")
            mapOf("saved" to true)
        }
    }

    override fun onDestroy(activity: AppCompatActivity) {
        sockets.values.forEach { runCatching { it.close() } }; sockets.clear()
        worker.shutdownNow(); timer.shutdownNow()
        super.onDestroy(activity)
    }
}
