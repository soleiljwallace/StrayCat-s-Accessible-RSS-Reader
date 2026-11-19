package com.straycat.rssreader

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Xml
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * Checks feeds in the background, even when the app is closed, and posts one
 * notification per new article. Tapping a notification opens that article.
 *
 * The app writes background.json (feeds, and what it already has) through
 * StrayPlugin.backgroundSync. This worker keeps its own seen.json, so it never
 * notifies about the same article twice. The first time it sees a feed it
 * only records what's there.
 */
class FeedCheckWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    private data class Item(
        var guid: String = "", var about: String = "", var id: String = "",
        var link: String = "", var title: String = ""
    ) {
        /** Same rule as the app (parse.js and app.js), so the article ids match. */
        fun appGuid(atom: Boolean): String {
            val g = if (atom) id.ifEmpty { link } else guid.ifEmpty { about }.ifEmpty { link }
            return g.ifEmpty { link }.ifEmpty { title }
        }
        fun key(atom: Boolean) = appGuid(atom)
    }

    private data class Fresh(val articleId: String, val title: String, val link: String, val feedTitle: String)

    override fun doWork(): Result {
        val ctx = applicationContext
        val stateFile = File(ctx.filesDir, STATE_FILE)
        if (!stateFile.exists()) return Result.success()
        val state = try { JSONObject(stateFile.readText()) } catch (e: Exception) { return Result.success() }
        if (!state.optBoolean("enabled")) return Result.success()

        val seenFile = File(ctx.filesDir, SEEN_FILE)
        val seen = try { JSONObject(seenFile.readText()) } catch (e: Exception) { JSONObject() }
        val fresh = mutableListOf<Fresh>()
        val feeds = state.optJSONArray("feeds") ?: JSONArray()

        for (i in 0 until feeds.length()) {
            val feed = feeds.getJSONObject(i)
            val feedId = feed.optString("id")
            val url = feed.optString("url")
            if (feedId.isEmpty() || url.isEmpty()) continue
            val known = HashSet<String>()
            feed.optJSONArray("known")?.let { arr -> for (k in 0 until arr.length()) known.add(arr.optString(k)) }

            val (items, atom) = try { fetchItems(url) } catch (e: Exception) { continue }
            val previous = seen.optJSONArray(feedId)
            val previousKeys = HashSet<String>()
            previous?.let { arr -> for (k in 0 until arr.length()) previousKeys.add(arr.optString(k)) }

            val current = JSONArray()
            for (item in items) {
                val key = item.key(atom)
                if (key.isEmpty()) continue
                current.put(key)
                // First look at this feed: just remember what's there.
                if (previous == null) continue
                if (key in previousKeys) continue
                if (key in known || item.link in known || item.title in known) continue
                fresh.add(Fresh("$feedId|${item.appGuid(atom)}", item.title.ifEmpty { "Untitled" }, item.link, feed.optString("title")))
            }
            seen.put(feedId, current)
        }
        seenFile.writeText(seen.toString())
        if (fresh.isNotEmpty()) postNotifications(ctx, fresh)
        return Result.success()
    }

    // ---------------------------------------------------------------- fetching and parsing

    private fun fetchItems(start: String): Pair<List<Item>, Boolean> {
        var url = start
        repeat(6) {
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15000
                readTimeout = 20000
                instanceFollowRedirects = false
                setRequestProperty("User-Agent", "Mozilla/5.0 (compatible; StrayCatRSS; +https://github.com/soleiljwallace/StrayCat-s-Accessible-RSS-Reader)")
                setRequestProperty("Accept", "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5")
            }
            try {
                val code = conn.responseCode
                if (code in 300..399) {
                    val loc = conn.getHeaderField("Location") ?: throw Exception("Redirect without location")
                    url = URL(URL(url), loc).toString()
                    return@repeat
                }
                if (code >= 400) throw Exception("HTTP $code")
                val type = conn.contentType ?: ""
                val charset = Regex("charset=([\\w-]+)", RegexOption.IGNORE_CASE).find(type)?.groupValues?.get(1)
                conn.inputStream.use { stream ->
                    return if (type.contains("json", true) || url.endsWith(".json")) parseJson(stream) to false
                    else parseXml(stream, charset)
                }
            } finally {
                conn.disconnect()
            }
        }
        throw Exception("Too many redirects")
    }

    private fun parseJson(stream: InputStream): List<Item> {
        val root = JSONObject(stream.readBytes().toString(Charsets.UTF_8))
        val arr = root.optJSONArray("items") ?: return emptyList()
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            val url = o.optString("url")
            val id = if (o.has("id")) o.get("id").toString() else url
            Item(guid = id.ifEmpty { o.optString("title") }, link = url, title = o.optString("title"))
        }
    }

    private fun parseXml(stream: InputStream, charset: String?): Pair<List<Item>, Boolean> {
        val p = Xml.newPullParser()
        p.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true)
        p.setInput(stream, charset)
        val items = mutableListOf<Item>()
        var atom = false
        var cur: Item? = null
        var itemDepth = 0
        var event = p.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            if (event == XmlPullParser.START_TAG) {
                val name = p.name
                if (p.depth == 1 && name == "feed") atom = true
                if (cur == null && (name == "item" || name == "entry")) {
                    cur = Item(about = p.getAttributeValue(RDF_NS, "about") ?: "")
                    itemDepth = p.depth
                } else if (cur != null && p.depth == itemDepth + 1 && isCoreNamespace(p.namespace)) {
                    when (name) {
                        "title" -> cur.title = text(p)
                        "guid" -> cur.guid = text(p)
                        "id" -> cur.id = text(p)
                        "link" -> {
                            val href = p.getAttributeValue(null, "href")
                            val rel = p.getAttributeValue(null, "rel")
                            if (href != null) {
                                if ((rel == null || rel == "alternate") && cur.link.isEmpty()) cur.link = href.trim()
                            } else {
                                val t = text(p)
                                if (t.isNotEmpty() && cur.link.isEmpty()) cur.link = t
                            }
                        }
                    }
                }
            } else if (event == XmlPullParser.END_TAG && cur != null && p.depth == itemDepth &&
                (p.name == "item" || p.name == "entry")) {
                items.add(cur)
                cur = null
            }
            event = p.next()
        }
        return items to atom
    }

    /** Text of the current element, including any markup inside it, flattened. */
    private fun text(p: XmlPullParser): String {
        val sb = StringBuilder()
        val depth = p.depth
        var event = p.next()
        while (!(event == XmlPullParser.END_TAG && p.depth == depth)) {
            if (event == XmlPullParser.TEXT || event == XmlPullParser.CDSECT) sb.append(p.text)
            event = p.next()
        }
        return sb.toString().trim()
    }

    private fun isCoreNamespace(ns: String?): Boolean =
        ns.isNullOrEmpty() || ns == ATOM_NS || ns == RSS1_NS

    // ---------------------------------------------------------------- notifications

    private fun postNotifications(ctx: Context, fresh: List<Fresh>) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "New articles", NotificationManager.IMPORTANCE_DEFAULT))
        }
        val icon = ctx.applicationInfo.icon
        fun builder(): Notification.Builder =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(ctx, CHANNEL)
            else @Suppress("DEPRECATION") Notification.Builder(ctx)

        try {
            for (f in fresh.take(MAX_EACH)) {
                val n = builder()
                    .setSmallIcon(icon)
                    .setContentTitle(f.title)
                    .setContentText(f.feedTitle)
                    .setSubText(f.feedTitle)
                    .setAutoCancel(true)
                    .setGroup(GROUP)
                    .setContentIntent(openIntent(ctx, f))
                    .build()
                nm.notify(f.articleId.hashCode(), n)
            }
            // A summary groups them in the notification shade. Tapping it opens All articles.
            val byFeed = fresh.groupingBy { it.feedTitle }.eachCount().entries
                .sortedByDescending { it.value }.joinToString(", ") { "${it.key} (${it.value})" }
            val summary = builder()
                .setSmallIcon(icon)
                .setContentTitle("${fresh.size} new article${if (fresh.size == 1) "" else "s"}")
                .setContentText(byFeed)
                .setStyle(Notification.InboxStyle().also { s -> fresh.take(6).forEach { s.addLine(it.title) } })
                .setGroup(GROUP)
                .setGroupSummary(true)
                .setAutoCancel(true)
                .setContentIntent(openIntent(ctx, null))
                .build()
            nm.notify(SUMMARY_ID, summary)
        } catch (e: SecurityException) {
            // Notifications are turned off for the app.
        }
    }

    private fun openIntent(ctx: Context, f: Fresh?): PendingIntent {
        val intent = (ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent()).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            if (f != null) {
                putExtra(EXTRA_ARTICLE, JSONObject().put("id", f.articleId).put("link", f.link).put("title", f.title).toString())
            }
        }
        return PendingIntent.getActivity(
            ctx, f?.articleId?.hashCode() ?: SUMMARY_ID, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
    }

    companion object {
        const val EXTRA_ARTICLE = "com.straycat.rssreader.ARTICLE"
        const val STATE_FILE = "background.json"
        private const val SEEN_FILE = "seen.json"
        private const val WORK_NAME = "feed-check"
        private const val CHANNEL = "new-articles"
        private const val GROUP = "com.straycat.rssreader.NEW_ARTICLES"
        private const val SUMMARY_ID = 1
        private const val MAX_EACH = 20
        private const val RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
        private const val ATOM_NS = "http://www.w3.org/2005/Atom"
        private const val RSS1_NS = "http://purl.org/rss/1.0/"

        fun schedule(ctx: Context, enabled: Boolean, intervalMinutes: Long) {
            val wm = WorkManager.getInstance(ctx)
            if (!enabled || intervalMinutes <= 0) {
                wm.cancelUniqueWork(WORK_NAME)
                return
            }
            // Android runs background work at most every 15 minutes.
            val request = PeriodicWorkRequest.Builder(
                FeedCheckWorker::class.java, maxOf(15L, intervalMinutes), TimeUnit.MINUTES
            ).setConstraints(
                Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            ).build()
            wm.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
        }
    }
}
