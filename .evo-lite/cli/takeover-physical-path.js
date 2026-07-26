'use strict';
// 中性路径原语。刻意【不】依赖 runtime / receipt / installer / memory service，也【不】持有任何
// 模块级可变 fs seam —— fsOps 每次由调用方显式传入。这样 installer（函数级 fsOps 参数）与
// receipt（模块级 seam）能共用同一实现，而不会把 installer 绑进一个它无权控制的全局 seam。
const path = require('path');

const PATH_CODES = {
    NOT_ABSOLUTE: 'ATTP_NOT_ABSOLUTE',
    NO_EXISTING_ANCESTOR: 'ATTP_NO_EXISTING_ANCESTOR',
    BROKEN_LINK: 'ATTP_BROKEN_LINK',
    REALPATH_FAILED: 'ATTP_REALPATH_FAILED',
    STAT_FAILED: 'ATTP_STAT_FAILED',
};

// 调用方要靠 code 恢复各自既有的错误文案，靠 target/probe 填插值，靠 cause 保留底层原因。
function pathError(code, message, fields) {
    const e = new Error(message);
    e.code = code;
    e.target = fields.target;
    e.probe = fields.probe;
    if (fields.cause) e.cause = fields.cause;
    return e;
}

// 返回【已物理验证的前缀 + 回拼的未存在尾部】的绝对路径。
//
// 两个承重点：
// (1) 用 lstat 而非 exists 找最近存在条目。断链 symlink 的 exists 为 false，若把它当成
//     "还没建的文件"跳过去，调用方就会拿祖先做 containment 判定并放行，而真正的写会沿链接
//     落到别处（R7 复审 P0-1 在守卫侧修的就是这个）。
// (2) 必须【回拼】未存在的尾部。只比较祖先对项目包含判定无害（祖先仍在项目内），但对
//     "允许根"判定是致命的：写 <root>/memory/new.md 而 memory/ 尚不存在时，祖先退到 <root>，
//     不在 <root>/memory 之下 —— 每个新项目的第一次记忆写入都会被拒。
function resolvePhysicalPath(target, fsOps) {
    const abs = String(target);
    if (!path.isAbsolute(abs)) {
        // 相对性解析属于调用方（守卫按 projectRoot 解析，installer 也按 projectRoot 解析）。
        // 在这里静默按 cwd 解析会造成一个只在某些工作目录下才复现的错判。
        // NOT_ABSOLUTE 是唯一的例外：此时还没有可 resolve 的绝对目标，target 保留原始字符串。
        throw pathError(PATH_CODES.NOT_ABSOLUTE, `path must be absolute: ${abs}`, { target: abs, probe: abs });
    }
    // requested 与 probe 承载两个【不同】的诊断事实，任何一处把 target 写成 probe 都会
    // 在上溯过 ≥1 级之后丢掉调用方原本请求的路径：
    //   target = 调用方请求解析的完整路径（恒定）
    //   probe  = 物理证明失败的那一级祖先（随上溯变化）
    const requested = path.resolve(abs);
    let probe = requested;
    const tail = [];
    for (;;) {
        let st;
        try {
            st = fsOps.lstatSync(probe);
        } catch (e) {
            // 只有【真实 fs 错误】才包装成 coded path error。没有字符串 code 的异常是程序缺陷
            // （典型是 TypeError），必须原样冒泡 —— 一旦被包装，下游会把它当成正常的路径不可用
            // 而降级成 {ok:false}，缺陷就被静默吞掉了。
            if (!e || typeof e.code !== 'string') throw e;
            if (e.code !== 'ENOENT') {
                // 权限等异常不得当成"不存在" —— 那会让调用方退到一个它本无权判定的祖先。
                // 已裁定：installer 也统一到这一侧（设计 §6.2.1），不提供 treat-as-missing 模式。
                throw pathError(PATH_CODES.STAT_FAILED, `cannot stat ${probe} (${e.message})`,
                    { target: requested, probe, cause: e });
            }
            const parent = path.dirname(probe);
            if (parent === probe) {
                throw pathError(PATH_CODES.NO_EXISTING_ANCESTOR, `no existing ancestor for ${requested}`,
                    { target: requested, probe });
            }
            tail.unshift(path.basename(probe));
            probe = parent;
            continue;
        }
        let physical;
        try {
            physical = fsOps.realpathSync(probe);
        } catch (e) {
            if (!e || typeof e.code !== 'string') throw e;   // 同上：程序缺陷原样冒泡
            // 断链与一般解析失败必须分得开：installer 对断链有专门文案，守卫对两者用同一条。
            // 但 symlink 的 realpath 失败【不都是断链】—— EACCES/EPERM/ELOOP/EIO 只是解析不了，
            // 全归为 BROKEN_LINK 会让 installer 对一个权限不足的链接输出误导性文案。
            const dangling = st && st.isSymbolicLink() && (e.code === 'ENOENT' || e.code === 'ENOTDIR');
            throw pathError(dangling ? PATH_CODES.BROKEN_LINK : PATH_CODES.REALPATH_FAILED,
                `cannot resolve ${probe} (${e.message})`, { target: requested, probe, cause: e });
        }
        return tail.length ? path.join(physical, ...tail) : physical;
    }
}

module.exports = { resolvePhysicalPath, PATH_CODES };
