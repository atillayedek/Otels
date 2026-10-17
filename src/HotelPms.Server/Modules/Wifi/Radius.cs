using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace HotelPms.Server.Modules.Wifi;

/// <summary>
/// RADIUS paket katmanı (RFC 2865 doğrulama, RFC 2866 oturum kaydı, RFC 3579 Message-Authenticator).
/// Yalnız misafir girişi için gereken kısım: PAP ve CHAP ile Access-Request, Accounting-Request.
/// </summary>
public sealed class RadiusPacket
{
    public const byte AccessRequest = 1, AccessAccept = 2, AccessReject = 3, AccountingRequest = 4, AccountingResponse = 5;
    public const byte AttrUserName = 1, AttrUserPassword = 2, AttrChapPassword = 3, AttrNasIp = 4, AttrFramedIp = 8, AttrReplyMessage = 18,
        AttrClass = 25, AttrSessionTimeout = 27, AttrCallingStationId = 31, AttrAcctStatusType = 40, AttrAcctInputOctets = 42,
        AttrAcctOutputOctets = 43, AttrAcctSessionId = 44, AttrAcctTerminateCause = 49, AttrAcctInputGigawords = 52, AttrAcctOutputGigawords = 53,
        AttrChapChallenge = 60, AttrMessageAuthenticator = 80;

    public byte Code { get; init; }
    public byte Identifier { get; init; }
    public byte[] Authenticator { get; init; } = new byte[16];
    public List<(byte Type, byte[] Value)> Attributes { get; } = [];

    public byte[]? Get(byte type) => Attributes.FirstOrDefault(a => a.Type == type).Value;
    public string? GetString(byte type) => Get(type) is { } v ? Encoding.UTF8.GetString(v) : null;
    public uint? GetUInt(byte type) => Get(type) is { Length: 4 } v ? BinaryPrimitives.ReadUInt32BigEndian(v) : null;
    public string? GetIp(byte type) => Get(type) is { Length: 4 } v ? new System.Net.IPAddress(v).ToString() : null;

    /// <summary>Paketi çözer; biçimi bozuksa null döner (sessizce atılır, RFC 2865 §3).</summary>
    public static RadiusPacket? Parse(byte[] data)
    {
        if (data.Length < 20) return null;
        var len = BinaryPrimitives.ReadUInt16BigEndian(data.AsSpan(2));
        if (len < 20 || len > 4096 || len > data.Length) return null;
        var p = new RadiusPacket { Code = data[0], Identifier = data[1], Authenticator = data[4..20] };
        var i = 20;
        while (i < len)
        {
            if (i + 2 > len) return null;
            var t = data[i]; var l = data[i + 1];
            if (l < 2 || i + l > len) return null;
            p.Attributes.Add((t, data[(i + 2)..(i + l)]));
            i += l;
        }
        return p;
    }

    /// <summary>Paketi bayt dizisine çevirir (Authenticator alanı olduğu gibi yazılır).</summary>
    public byte[] Serialize()
    {
        var body = new List<byte>();
        foreach (var (t, v) in Attributes)
        {
            if (v.Length > 253) throw new InvalidOperationException("RADIUS özniteliği çok uzun.");
            body.Add(t); body.Add((byte)(v.Length + 2)); body.AddRange(v);
        }
        var buf = new byte[20 + body.Count];
        buf[0] = Code; buf[1] = Identifier;
        BinaryPrimitives.WriteUInt16BigEndian(buf.AsSpan(2), (ushort)buf.Length);
        Authenticator.CopyTo(buf, 4);
        body.CopyTo(buf, 20);
        return buf;
    }

    /// <summary>Gelen paketteki Message-Authenticator (HMAC-MD5) doğruysa veya yoksa true; varsa ve yanlışsa false.</summary>
    public static bool MessageAuthenticatorValid(byte[] raw, RadiusPacket p, byte[] secret, byte[]? authenticatorForHmac = null)
    {
        var ma = p.Get(AttrMessageAuthenticator);
        if (ma is null) return true;
        if (ma.Length != 16) return false;
        var copy = (byte[])raw.Clone();
        var len = BinaryPrimitives.ReadUInt16BigEndian(copy.AsSpan(2));
        if (authenticatorForHmac is not null) authenticatorForHmac.CopyTo(copy, 4);
        for (var i = 20; i < len;)
        {
            if (copy[i] == AttrMessageAuthenticator) { Array.Clear(copy, i + 2, 16); break; }
            i += copy[i + 1];
        }
        var expect = HMACMD5.HashData(secret, copy.AsSpan(0, len));
        return CryptographicOperations.FixedTimeEquals(expect, ma);
    }

    /// <summary>Accounting-Request doğrulayıcısını denetler: MD5(Code+ID+Len+16 sıfır+Öznitelikler+Gizli).</summary>
    public static bool AccountingRequestValid(byte[] raw, byte[] secret)
    {
        var len = BinaryPrimitives.ReadUInt16BigEndian(raw.AsSpan(2));
        var copy = raw[..len];
        var got = copy[4..20];
        Array.Clear(copy, 4, 16);
        var expect = MD5.HashData([.. copy, .. secret]);
        return CryptographicOperations.FixedTimeEquals(expect, got);
    }

    /// <summary>PAP şifresini çözer (RFC 2865 §5.2). Biçim hatalıysa null.</summary>
    public static string? DecryptPap(byte[] cipher, byte[] requestAuthenticator, byte[] secret)
    {
        if (cipher.Length == 0 || cipher.Length % 16 != 0 || cipher.Length > 128) return null;
        var plain = new byte[cipher.Length];
        var prev = requestAuthenticator;
        for (var i = 0; i < cipher.Length; i += 16)
        {
            var b = MD5.HashData([.. secret, .. prev]);
            for (var j = 0; j < 16; j++) plain[i + j] = (byte)(cipher[i + j] ^ b[j]);
            prev = cipher[i..(i + 16)];
        }
        var end = Array.IndexOf(plain, (byte)0);
        return Encoding.UTF8.GetString(plain, 0, end < 0 ? plain.Length : end);
    }

    /// <summary>CHAP yanıtı adaydaki şifreyle üretilmiş mi (RFC 1994: MD5(ID + şifre + challenge)).</summary>
    public static bool ChapMatches(byte[] chapPassword, byte[] challenge, string candidate)
    {
        if (chapPassword.Length != 17) return false;
        var expect = MD5.HashData([chapPassword[0], .. Encoding.UTF8.GetBytes(candidate), .. challenge]);
        return CryptographicOperations.FixedTimeEquals(expect, chapPassword.AsSpan(1));
    }

    /// <summary>
    /// Yanıt paketi üretir: istekte Message-Authenticator olmasa da yanıta eklenir (RFC 3579; BlastRADIUS önlemi),
    /// ardından Response Authenticator = MD5(Code+ID+Len+RequestAuth+Öznitelikler+Gizli) hesaplanır.
    /// </summary>
    public static byte[] BuildResponse(byte code, RadiusPacket request, byte[] secret, IEnumerable<(byte Type, byte[] Value)> attributes, bool addMessageAuthenticator)
    {
        var p = new RadiusPacket { Code = code, Identifier = request.Identifier, Authenticator = request.Authenticator };
        if (addMessageAuthenticator) p.Attributes.Add((AttrMessageAuthenticator, new byte[16]));
        p.Attributes.AddRange(attributes);
        var buf = p.Serialize();
        if (addMessageAuthenticator)
        {
            var mac = HMACMD5.HashData(secret, buf);
            mac.CopyTo(buf, 22); // ilk öznitelik: 20 bayt başlık + 2 bayt tür/uzunluk
        }
        var auth = MD5.HashData([.. buf, .. secret]);
        auth.CopyTo(buf, 4);
        return buf;
    }

    public static byte[] Str(string s) => Encoding.UTF8.GetBytes(s.Length > 120 ? s[..120] : s);
    public static byte[] UInt(uint v) { var b = new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(b, v); return b; }
}
